import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSheetData } from "@/services/google-api";
import type { BidGridWin } from "@/lib/bidGridParsing";
import { Bidder, AuctionItem } from "@/types";
import type { CheckoutStatusFilter, WinnerRecord } from "./useCheckoutState";

interface UseWinnersListArgs {
  bidders: Bidder[];
  items: AuctionItem[];
  /** The Bid-Management grid's wins, read once by AuctionContext's useWinnersData. */
  bidGridWins: BidGridWin[];
  /** Re-reads that grid (updating `bidGridWins`); resolves false if the read failed. */
  fetchWinners: () => Promise<boolean>;
  fetchAllData: () => Promise<void>;
  spreadsheetId: string;
}

/** Groups the grid's wins by bidder, with names, totals and payment state. */
function buildWinnerRecords(wins: BidGridWin[], bidders: Bidder[], items: AuctionItem[]): WinnerRecord[] {
  const byBidder = new Map<string, { id: string; name: string; price: number }[]>();
  for (const win of wins) {
    const itemInfo = items.find(it => it.id === win.itemId);
    const wonItems = byBidder.get(win.bidderId) ?? [];
    wonItems.push({ id: win.itemId, name: itemInfo?.name || "Unknown Item", price: win.price });
    byBidder.set(win.bidderId, wonItems);
  }

  const itemsList: WinnerRecord[] = [];
  for (const [bidderId, wonItems] of byBidder) {
    const bidderInfo = bidders.find(b => b.id === bidderId);
    itemsList.push({
      bidderId,
      name: bidderInfo ? `${bidderInfo.firstName} ${bidderInfo.lastName}` : `Bidder ${bidderId}`,
      total: wonItems.reduce((sum, it) => sum + it.price, 0),
      items: wonItems,
      paid: bidderInfo?.paid || false,
      paymentPending: !!bidderInfo?.checkoutTimestamp && !bidderInfo?.paid,
      paymentMethod: bidderInfo?.paymentMethod || ""
    });
  }
  return itemsList;
}

/**
 * Loads and filters the checkout screen's per-bidder winners list: the
 * per-bidder grouping of the bid grid, the Special-Winners
 * high-value-alert lookup, search/status filtering, and the refresh flow.
 * Split out of useCheckoutState.ts (was 416 lines) so that container
 * stays focused on composing the split-out pieces.
 *
 * The bid grid itself comes from AuctionContext (ROADMAP.md R16) - this
 * hook used to read Bid-Management `A:ZZ` again every time the bidders
 * changed, right alongside the context's own read. It still asks for one
 * fresh read when Checkout opens, since a bid entered on this device
 * since the last read isn't in the context's grid yet.
 */
export function useWinnersList({ bidders, items, bidGridWins, fetchWinners, fetchAllData, spreadsheetId }: UseWinnersListArgs) {
  const [winners, setWinners] = useState<WinnerRecord[]>([]);
  const [fetchingWinners, setFetchingWinners] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<CheckoutStatusFilter>("all");
  const [specialWinners, setSpecialWinners] = useState<{ name: string; bidderId: string }[]>([]);

  const loadWinners = useCallback(async () => {
    if (!spreadsheetId) return;

    setFetchingWinners(true);
    try {
      // Fetch special winners for alerts
      const specialData = await getSheetData(spreadsheetId, "Special-Winners!A2:B3");
      if (specialData.values) {
        setSpecialWinners(specialData.values.map((row: string[]) => ({
          // row[0] previously had no fallback despite `name` being typed
          // string - a type-safety gap, not a currently-observable bug:
          // its one consumer (useCheckoutPaymentFlow.ts's handleMarkPaid)
          // only ever reads it through `.join(" and ")`, which already
          // treats a genuinely `undefined` array element as an empty
          // string. Still worth defaulting explicitly so the type stays
          // honest for any future direct (non-`.join()`) use.
          name: row[0]?.toString() || "",
          bidderId: row[1]?.toString() || ""
        })));
      }

      if (!(await fetchWinners())) toast.error("Failed to load winners");
    } catch (error) {
      console.error(error);
      toast.error("Failed to load winners");
    } finally {
      setFetchingWinners(false);
    }
  }, [spreadsheetId, fetchWinners]);

  const handleRefresh = async () => {
    setFetchingWinners(true);
    try {
      await fetchAllData();
      await loadWinners();
    } finally {
      // loadWinners has its own finally, but only when it actually runs
      // its try block - it early-returns before that (no spreadsheetId)
      // without resetting fetchingWinners, and fetchAllData() itself can
      // throw before loadWinners is ever called. Either path would leave
      // the refresh spinner stuck forever without this finally.
      setFetchingWinners(false);
    }
  };

  // One fresh read when Checkout opens (or the spreadsheet changes) -
  // not on every bidders change, which AuctionContext already re-reads for.
  const loadWinnersRef = useRef(loadWinners);
  loadWinnersRef.current = loadWinners;
  useEffect(() => {
    loadWinnersRef.current();
  }, [spreadsheetId]);

  // Rebuilt in an effect, not derived, because useCheckoutPaymentFlow
  // marks a winner paid optimistically through setWinners.
  useEffect(() => {
    if (bidders.length && items.length) {
      setWinners(buildWinnerRecords(bidGridWins, bidders, items));
    }
  }, [bidGridWins, bidders, items]);

  // Winner-level status - was previously also used to compute a
  // Pending/Completed tab split, but that split was strictly redundant
  // with this same classification (the "Pending Checkout" tab was
  // exactly `status === "awaiting"`, "Already Checked Out" was exactly
  // `status === "review" || "paid"`) - a Status filter that can already
  // isolate all three individually makes a coarser 2-way tab split
  // pure duplicated effort, per explicit user feedback. Removed the
  // tabs entirely in favor of this one filter. See CHANGELOG.md.
  const winnerStatus = useCallback((w: WinnerRecord): CheckoutStatusFilter => {
    const bidder = bidders.find(b => b.id === w.bidderId);
    if (!bidder?.checkedOut) return "awaiting";
    if (w.paymentPending) return "review";
    return "paid";
  }, [bidders]);

  const filteredWinners = useMemo(() => {
    const matchesSearch = (w: WinnerRecord) => {
      const nameMatch = w.name.toLowerCase().includes(searchTerm.toLowerCase());
      const idMatch = w.bidderId.includes(searchTerm);
      return nameMatch || idMatch;
    };
    const matchesStatus = (w: WinnerRecord) => statusFilter === "all" || winnerStatus(w) === statusFilter;

    return winners.filter(matchesSearch).filter(matchesStatus);
  }, [winners, searchTerm, statusFilter, winnerStatus]);

  // Overview stats for the top-of-page KPI row - always computed against
  // the full, unfiltered winners list (not search/status-scoped), so
  // the row stays a stable snapshot of the whole auction's checkout
  // progress regardless of what's currently being searched/filtered.
  const stats = useMemo(() => {
    let awaitingCount = 0;
    let reviewCount = 0;
    let paidCount = 0;
    let totalCollected = 0;
    let totalWon = 0;

    for (const w of winners) {
      totalWon += w.total;
      const status = winnerStatus(w);
      if (status === "awaiting") awaitingCount++;
      else if (status === "review") reviewCount++;
      else {
        paidCount++;
        totalCollected += w.total;
      }
    }

    return {
      totalWinners: winners.length,
      awaitingCount,
      checkedOutCount: reviewCount + paidCount,
      totalCollected,
      totalWon,
    };
  }, [winners, winnerStatus]);

  return {
    winners,
    setWinners,
    fetchingWinners,
    specialWinners,
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    filteredWinners,
    stats,
    handleRefresh,
  };
}
