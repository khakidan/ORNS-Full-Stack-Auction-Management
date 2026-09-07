import { useCallback, useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl, getSheetData } from "@/services/google-api";
import { parseBidGrid } from "@/lib/bidGridParsing";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { AuctionItem, Bidder } from "@/types";

export function useWinnersData(spreadsheetId: string, bidders: Bidder[], items: AuctionItem[], bidManagementSheet: string, bidderNumbersSheet: string) {
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [totalRaised, setTotalRaised] = useState(0);

  const fetchWinners = useCallback(async () => {
    if (!spreadsheetId || bidders.length === 0) return;
    try {
      const data = await getSheetData(spreadsheetId, `${bidManagementSheet}!A:ZZ`);
      const wins = parseBidGrid(data?.values);

      // Bidder cache for faster lookup
      const bidderCache = new Map(bidders.map(b => [b.id, b]));

      const newWinners: Record<string, string> = {};
      let total = 0;
      for (const win of wins) {
        const bidder = bidderCache.get(win.bidderId);
        newWinners[win.itemId] = bidder ? `${bidder.firstName} ${bidder.lastName}` : `Bidder ${win.bidderId}`;
        total += win.price;
      }

      setWinners(newWinners);
      setTotalRaised(total);
    } catch (e) {
      console.error("Error fetching winners:", e);
    }
  }, [spreadsheetId, bidders, bidManagementSheet]);

  const recordWinningBid = async (bidderId: string, itemId: string, price: number) => {
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

    // 2. Optimistic Update
    setWinners(prev => ({ ...prev, [itemId]: bidderName }));
    setTotalRaised(prev => prev + price);

    // 3. Background Sync
    const idempotencyKey = crypto.randomUUID();

    fetchWithRetry(`${getBaseUrl()}/api/auction/record-winning-bid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bidderId,
        itemId,
        price,
        spreadsheetId,
        bidManagementSheet,
        bidderNumbersSheet,
        idempotencyKey
      }),
      credentials: "include"
    })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to sync bid");
        }
        return res.json();
      })
      .then((data) => {
        toast.success(`Synced bid: ${bidderName} — ${itemId} — $${price}`);
        if (data.followUpAdded) {
          // Matches useDashboardState.ts's special-winners warning exactly -
          // patterns.md requires duration: Infinity and an "I have
          // confirmed" action for a bidder who already checked out winning
          // something, with the item explicitly named in the message.
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
      })
      .catch(e => {
        console.error("Bid sync failed", e);
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
      });
  };

  return { winners, totalRaised, fetchWinners, recordWinningBid };
}
