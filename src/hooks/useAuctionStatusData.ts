import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getSheetData } from "@/services/google-api";
import { postJson } from "@/services/apiClient";

export function useAuctionStatusData(spreadsheetId: string, bidManagementSheet: string, bidderNumbersSheet: string) {
  const [isAuctionClosed, setIsAuctionClosed] = useState(false);

  const fetchAuctionStatus = useCallback(async () => {
    if (!spreadsheetId) return;
    try {
      const data = await getSheetData(spreadsheetId, "Auction-Status!A2");
      if (data.values && data.values[0]) {
        const val = data.values[0][0];
        setIsAuctionClosed(val === false || val === "FALSE");
      }
    } catch (e) {
      console.error("Error fetching auction status:", e);
    }
  }, [spreadsheetId]);

  /**
   * Closes the auction and runs server-side cleanup. Returns whether it
   * succeeded - callers that need to refresh all auction data afterward
   * (currently only AuctionContext's `closeAuction`) do so themselves,
   * since that's a cross-domain concern this hook doesn't own. All
   * errors are caught and toasted here; this never throws.
   */
  const requestCloseAuction = useCallback(async (): Promise<boolean> => {
    if (!spreadsheetId) return false;
    try {
      const data = await postJson("/api/auction/close-and-cleanup", {
        spreadsheetId,
        bidderNumbersSheet,
        bidManagementSheet
      }, "Failed to close auction and cleanup");
      setIsAuctionClosed(true);
      toast.success("Auction closed successfully.");
      if (data.count > 0) {
        toast.info(`Automatically checked out ${data.count} non-winning bidders.`);
      }
      return true;
    } catch (e: any) {
      console.error("Error closing auction:", e);
      toast.error("Failed to close auction: " + e.message);
      return false;
    }
  }, [spreadsheetId, bidManagementSheet, bidderNumbersSheet]);

  return { isAuctionClosed, fetchAuctionStatus, requestCloseAuction };
}
