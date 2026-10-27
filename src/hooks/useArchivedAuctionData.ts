import { useEffect, useMemo, useState } from "react";
import { getSheetData } from "@/services/google-api";
import { parseBidderRows } from "@/lib/bidderParsing";
import { parseBidGrid } from "@/lib/bidGridParsing";
import { parseItemRows } from "@/lib/itemParsing";
import { computeArchiveAttendance } from "@/lib/archiveStats";
import { ArchivedAuction, AuctionItem, Bidder } from "@/types";

/**
 * Reads one past auction's Bidders, Items and winning bids from its
 * archived spreadsheet copies, using the same parsers as the live
 * Bid Management tabs. Read-only; loads once when the year's tab opens.
 * `hasData` is false when the archive is missing or its Bidder-Numbers
 * sheet is empty - the page then says there isn't enough information.
 */
export function useArchivedAuctionData(auction: ArchivedAuction, bidderNumbersSheet: string, bidManagementSheet: string) {
  const { bidManagementSpreadsheetId, itemsSpreadsheetId } = auction;
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [totalRaised, setTotalRaised] = useState(0);
  const [loading, setLoading] = useState(!!bidManagementSpreadsheetId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bidManagementSpreadsheetId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [bidderData, gridData, itemData] = await Promise.all([
          getSheetData(bidManagementSpreadsheetId, `${bidderNumbersSheet}!A:L`),
          getSheetData(bidManagementSpreadsheetId, `${bidManagementSheet}!A:ZZ`),
          itemsSpreadsheetId ? getSheetData(itemsSpreadsheetId, "Auction-Items!A:Z") : Promise.resolve({ values: [] }),
        ]);
        if (cancelled) return;

        const parsedBidders = bidderData?.values?.length > 1 ? parseBidderRows(bidderData.values.slice(1)) : [];
        const byId = new Map(parsedBidders.map((b) => [b.id, b]));
        const wins = parseBidGrid(gridData?.values);
        const winnerNames: Record<string, string> = {};
        let total = 0;
        for (const win of wins) {
          const b = byId.get(win.bidderId);
          winnerNames[win.itemId] = b ? `${b.firstName} ${b.lastName}` : `Bidder ${win.bidderId}`;
          total += win.price;
        }

        setBidders(parsedBidders);
        setWinners(winnerNames);
        setTotalRaised(total);
        setItems(itemData?.values?.length > 1 ? parseItemRows(itemData.values) : []);
      } catch (e: any) {
        if (cancelled) return;
        console.error("Failed to load archived auction:", e);
        setError(e.message || "Couldn't read the archived spreadsheets.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bidManagementSpreadsheetId, itemsSpreadsheetId, bidderNumbersSheet, bidManagementSheet]);

  const attendance = useMemo(() => computeArchiveAttendance(bidders), [bidders]);

  return { bidders, items, winners, totalRaised, attendance, loading, error, hasData: bidders.length > 0 };
}
