import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getSheetData } from "@/services/google-api";
import { parseBidderRows } from "@/lib/bidderParsing";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { Bidder } from "@/types";
import { postJson } from "@/services/apiClient";

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

  // checkInBidder and markBidderAsProxy are the same optimistic-update/
  // server-save/scoped-rollback flow apart from which box they tick. The
  // server's /api/bidders/set-flag finds the row and writes it under the
  // `bidder-numbers:` lock, like every other Bidder-Numbers write.
  const setBidderFlag = async (
    bidder: Bidder,
    field: 'checkedIn' | 'isProxy',
    successMessage: string
  ) => {
    if (!spreadsheetId) return;

    // 1. Store this bidder's previous value for a scoped rollback, not a
    // whole-array snapshot - a second bidder's mutation committed while
    // this one is still in flight must not be erased by this rollback.
    const previousValue = bidder[field];

    // 2. Optimistic Update (Immediate UI change)
    setBidders(prev => prev.map(b => b.id === bidder.id ? { ...b, [field]: true } : b));

    // 3. Save on the server
    try {
      await postJson("/api/bidders/set-flag", { spreadsheetId, bidderNumbersSheet, bidderId: bidder.id, flag: field }, "The server didn't save the change.");
      toast.success(successMessage);
    } catch (e) {
      console.error(e);
      // 4. Rollback on failure - scoped to just this bidder.
      setBidders(prev => prev.map(b => b.id === bidder.id ? { ...b, [field]: previousValue } : b));
      toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
    }
  };

  const checkInBidder = (bidder: Bidder) =>
    setBidderFlag(bidder, 'checkedIn', `${bidder.firstName} ${bidder.lastName} checked in (Synced)`);

  const markBidderAsProxy = (bidder: Bidder) =>
    setBidderFlag(bidder, 'isProxy', `${bidder.firstName} ${bidder.lastName} marked as Proxy Bidder`);

  return { bidders, loading, setLoading, fetchBidders, checkInBidder, markBidderAsProxy };
}
