import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getSheetData } from "@/services/google-api";
import { parseBidGrid } from "@/lib/bidGridParsing";
import { Bidder, AuctionItem } from "@/types";
import type { WinnerRecord } from "./useCheckoutState";

interface UseWinnersListArgs {
  bidders: Bidder[];
  items: AuctionItem[];
  fetchAllData: () => Promise<void>;
  spreadsheetId: string;
  bidManagementSheet: string;
}

/**
 * Loads and filters the checkout screen's per-bidder winners list: the
 * Bid-Management bid-grid parse, the Special-Winners high-value-alert
 * lookup, search/tab filtering, and the refresh flow. Split out of
 * useCheckoutState.ts (was 416 lines) so that container stays focused on
 * composing the split-out pieces.
 */
export function useWinnersList({ bidders, items, fetchAllData, spreadsheetId, bidManagementSheet }: UseWinnersListArgs) {
  const [winners, setWinners] = useState<WinnerRecord[]>([]);
  const [fetchingWinners, setFetchingWinners] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");
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

      const sheetName = bidManagementSheet;
      const data = await getSheetData(spreadsheetId, `${sheetName}!A:ZZ`);
      const wins = parseBidGrid(data?.values);

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
          paymentPending: !!bidderInfo?.checkoutTimestamp && !bidderInfo?.paid
        });
      }
      setWinners(itemsList);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load winners");
    } finally {
      setFetchingWinners(false);
    }
  }, [spreadsheetId, bidManagementSheet, items, bidders]);

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

  useEffect(() => {
    if (bidders.length && items.length) {
      loadWinners();
    }
  }, [bidders, items, loadWinners]);

  const filteredWinners = useMemo(() => {
    const pendingWinners = winners.filter(w => {
      const bidder = bidders.find(b => b.id === w.bidderId);
      return !bidder?.checkedOut;
    });

    const completedWinners = winners.filter(w => {
      const bidder = bidders.find(b => b.id === w.bidderId);
      return bidder?.checkedOut === true;
    });

    const displayedWinners = activeTab === "pending" ? pendingWinners : completedWinners;

    const filtered = displayedWinners.filter(w => {
      const nameMatch = w.name.toLowerCase().includes(searchTerm.toLowerCase());
      const idMatch = w.bidderId.includes(searchTerm);
      return nameMatch || idMatch;
    });

    return { pendingWinners, completedWinners, filtered };
  }, [winners, bidders, activeTab, searchTerm]);

  return {
    winners,
    setWinners,
    fetchingWinners,
    specialWinners,
    searchTerm,
    setSearchTerm,
    activeTab,
    setActiveTab,
    pendingWinners: filteredWinners.pendingWinners,
    completedWinners: filteredWinners.completedWinners,
    filteredWinners: filteredWinners.filtered,
    handleRefresh,
  };
}
