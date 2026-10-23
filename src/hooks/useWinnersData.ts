import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl, getSheetData, ServerUnreachableError } from "@/services/google-api";
import { parseBidGrid, BidGridWin } from "@/lib/bidGridParsing";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { addToOutbox, getOutboxState, markNeedsSignIn, onOutboxSettled, RecordWinningBidBody } from "@/lib/bidOutbox";
import { AuctionItem, Bidder } from "@/types";

export function useWinnersData(
  spreadsheetId: string,
  bidders: Bidder[],
  items: AuctionItem[],
  bidManagementSheet: string,
  bidderNumbersSheet: string,
  /** Lets the server refuse a second winner for a one-winner item (Milestone A). */
  itemsSpreadsheetId?: string
) {
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [totalRaised, setTotalRaised] = useState(0);
  // The sheet's wins as parsed (no unsent outbox bids) - Checkout builds
  // its per-bidder list from these instead of reading the grid again.
  const [bidGridWins, setBidGridWins] = useState<BidGridWin[]>([]);

  /** Re-reads the bid grid. Resolves false if the read failed. */
  const fetchWinners = useCallback(async (): Promise<boolean> => {
    if (!spreadsheetId || bidders.length === 0) return true;
    try {
      const data = await getSheetData(spreadsheetId, `${bidManagementSheet}!A:ZZ`);
      const wins = parseBidGrid(data?.values);
      setBidGridWins(wins);

      // Bidder cache for faster lookup
      const bidderCache = new Map(bidders.map(b => [b.id, b]));

      const newWinners: Record<string, string> = {};
      let total = 0;
      for (const win of wins) {
        const bidder = bidderCache.get(win.bidderId);
        newWinners[win.itemId] = bidder ? `${bidder.firstName} ${bidder.lastName}` : `Bidder ${win.bidderId}`;
        total += win.price;
      }

      // Bids saved on this device but not sent yet aren't in the sheet.
      // Without them a reload would forget they're won - and Bid Entry
      // would let the same item be entered again.
      for (const entry of getOutboxState().entries) {
        if (entry.status === "needsReview" || entry.body.spreadsheetId !== spreadsheetId) continue;
        if (newWinners[entry.body.itemId] === undefined) total += entry.body.price;
        newWinners[entry.body.itemId] = entry.bidderName;
      }

      setWinners(newWinners);
      setTotalRaised(total);
      return true;
    } catch (e) {
      console.error("Error fetching winners:", e);
      return false;
    }
  }, [spreadsheetId, bidders, bidManagementSheet]);

  // When saved bids are sent (or refused) later, refresh from the sheet,
  // and give the same Checked Out Warning a live bid would have.
  const latest = useRef({ fetchWinners, items, bidders });
  latest.current = { fetchWinners, items, bidders };
  useEffect(() => onOutboxSettled((sent) => {
    for (const { entry, response } of sent) {
      if (response.followUpAdded) showCheckedOutWarning(entry.bidderName, entry.body.itemId, latest.current.items);
    }
    latest.current.fetchWinners();
  }), []);

  /**
   * Records a winning bid: shows it at once, sends it in the background,
   * and resolves with its idempotency key (Quick Entry uses it to show
   * whether this bid is still waiting to send).
   *
   * - The server answers OK: done.
   * - The server answers "no" (a 4xx such as bidder not found): undone on
   *   screen, as before.
   * - The server can't be reached (offline, or still failing after every
   *   retry): kept on screen and saved to the outbox, to send once the
   *   connection is back (Milestone A). Also when the sign-in expired
   *   (401) - it sends after staff sign in again.
   */
  const recordWinningBid = async (bidderId: string, itemId: string, price: number): Promise<string> => {
    if (!spreadsheetId) {
      throw new Error("Spreadsheet ID not configured");
    }

    // 1. Store just this item's previous value (undefined if it had no
    // winner yet), so a failure only reverts this one entry - not the
    // whole map. A second bid recorded before this one settles must not
    // have its own already-committed change wiped out by this rollback.
    const previousWinnerForItem = winners[itemId];

    // Find bidder name for optimistic UI
    const bidder = bidders.find(b => b.id === bidderId);
    const bidderName = bidder ? `${bidder.firstName} ${bidder.lastName}` : `Bidder ${bidderId}`;
    const item = items.find(i => i.id === itemId);

    // 2. Optimistic Update
    setWinners(prev => ({ ...prev, [itemId]: bidderName }));
    setTotalRaised(prev => prev + price);

    // 3. Background Sync
    const idempotencyKey = crypto.randomUUID();
    const body: RecordWinningBidBody = {
      bidderId,
      itemId,
      price,
      spreadsheetId,
      bidManagementSheet,
      bidderNumbersSheet,
      ...(itemsSpreadsheetId ? { itemsSpreadsheetId } : {}),
      idempotencyKey
    };

    const saveForLater = () => {
      const stored = addToOutbox(body, { bidderName, itemName: item ? item.name : `Item ${itemId}` });
      if (!stored) {
        toast.warning("This browser won't save bids to the device, so keep this tab open until the connection is back.", { duration: 10000 });
      }
    };

    // Known offline: skip the ~8 seconds of retries and save it now.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      saveForLater();
      return idempotencyKey;
    }

    const rollBack = () => {
      // 4. Rollback - scoped to just this item/amount, not a captured
      // whole-map snapshot.
      setWinners(prev => {
        const next = { ...prev };
        if (previousWinnerForItem === undefined) {
          delete next[itemId];
        } else {
          next[itemId] = previousWinnerForItem;
        }
        return next;
      });
      setTotalRaised(prev => prev - price);
      toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
    };

    fetchWithRetry(`${getBaseUrl()}/api/auction/record-winning-bid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include"
    })
      .then(async res => {
        if (res.status === 401) {
          saveForLater();
          markNeedsSignIn();
          return;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          console.error("Bid sync failed", err.error || res.status);
          rollBack();
          return;
        }
        const data = await res.json();
        toast.success(`Synced bid: ${bidderName} — ${itemId} — $${price}`);
        if (data.followUpAdded) showCheckedOutWarning(bidderName, itemId, items);
      })
      .catch(e => {
        if (e instanceof ServerUnreachableError) {
          console.warn("Bid saved on this device - the server couldn't be reached:", e.message);
          saveForLater();
          return;
        }
        console.error("Bid sync failed", e);
        rollBack();
      });

    return idempotencyKey;
  };

  return { winners, totalRaised, bidGridWins, fetchWinners, recordWinningBid };
}

/**
 * Matches useDashboardState.ts's special-winners warning exactly -
 * patterns.md requires duration: Infinity and an "I have confirmed" action
 * for a bidder who already checked out winning something, with the item
 * explicitly named in the message.
 */
function showCheckedOutWarning(bidderName: string, itemId: string, items: AuctionItem[]) {
  const item = items.find(i => i.id === itemId);
  const itemName = item ? item.name : `Item ${itemId}`;
  toast.warning("Checked Out Warning", {
    description: `Warning: ${bidderName} won "${itemName}" but has already checked out.`,
    duration: Infinity,
    action: {
      label: "I have confirmed",
      onClick: () => console.log("Confirmed checkout warning for winning bid"),
    },
  });
}
