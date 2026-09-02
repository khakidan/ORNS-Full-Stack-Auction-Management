import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getSheetData, updateSheetData } from "@/services/google-api";
import { parseBidderRows } from "@/lib/bidderParsing";
import { Bidder } from "@/types";

/**
 * Owns bidder list state and the check-in/proxy mutations. `loading`
 * reflects `fetchBidders` specifically, since it's the one fetch the
 * app gates its initial-load spinner on (see AuctionContext's combined
 * `loading` flag).
 */
export function useBiddersData(spreadsheetId: string, bidderNumbersSheet: string) {
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBidders = useCallback(async () => {
    if (!spreadsheetId) return;
    setLoading(true);
    try {
      const data = await getSheetData(spreadsheetId, `${bidderNumbersSheet}!A:L`);

      if (data && data.values?.length > 1) {
        setBidders(parseBidderRows(data.values.slice(1)));
      } else {
        setBidders([]);
      }
    } catch (e) {
      console.error(e);
      setBidders([]);
    } finally {
      setLoading(false);
    }
  }, [spreadsheetId, bidderNumbersSheet]);

  const checkInBidder = async (bidder: Bidder) => {
    if (!spreadsheetId) return;

    // 1. Store previous state for rollback
    const previousBidders = [...bidders];

    // 2. Optimistic Update (Immediate UI change)
    setBidders(prev => prev.map(b => b.id === bidder.id ? { ...b, checkedIn: true } : b));

    // 3. Background Sync
    getSheetData(spreadsheetId, `${bidderNumbersSheet}!A:A`)
      .then(data => {
        const rowIndex = data.values.findIndex((row: any) => row[0]?.toString() === bidder.id) + 1;
        if (rowIndex > 1) {
          return updateSheetData(spreadsheetId, `${bidderNumbersSheet}!E${rowIndex}`, [[true]]);
        } else {
          throw new Error("Bidder not found in management sheet.");
        }
      })
      .then(() => toast.success(`${bidder.firstName} ${bidder.lastName} checked in (Synced)`))
      .catch(e => {
        // 4. Rollback on failure
        setBidders(previousBidders);
        toast.error(`Failed to sync updates—retrying... local state reverted.`);
      });
  };

  const markBidderAsProxy = async (bidder: Bidder) => {
    if (!spreadsheetId) return;

    // 1. Store previous state for rollback
    const previousBidders = [...bidders];

    // 2. Optimistic Update
    setBidders(prev => prev.map(b => b.id === bidder.id ? { ...b, isProxy: true } : b));

    // 3. Background Sync
    getSheetData(spreadsheetId, `${bidderNumbersSheet}!A:A`)
      .then(data => {
        const rowIndex = data.values.findIndex((row: any) => row[0]?.toString() === bidder.id) + 1;
        if (rowIndex > 1) {
          return updateSheetData(spreadsheetId, `${bidderNumbersSheet}!F${rowIndex}`, [[true]]);
        } else {
          throw new Error("Bidder not found in sheet.");
        }
      })
      .then(() => toast.success(`${bidder.firstName} ${bidder.lastName} marked as Proxy Bidder`))
      .catch(err => {
        // 4. Rollback
        setBidders(previousBidders);
        toast.error("Failed to sync updates—retrying... local state reverted.");
      });
  };

  return { bidders, loading, setLoading, fetchBidders, checkInBidder, markBidderAsProxy };
}
