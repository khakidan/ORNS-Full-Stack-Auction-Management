import { useCallback, useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl, getSheetData } from "@/services/google-api";
import { postJson } from "@/services/apiClient";
import { AuctionState, parseAuctionState } from "@/lib/auctionState";

export function useAuctionStatusData(spreadsheetId: string, bidManagementSheet: string, bidderNumbersSheet: string) {
  const [auctionState, setAuctionState] = useState<AuctionState>("prep");
  const isAuctionClosed = auctionState === "closed";
  // null until checked: the header shows neither Set Up nor Go Live while unknown.
  const [isBidManagementSetUp, setIsBidManagementSetUp] = useState<boolean | null>(null);

  const fetchAuctionStatus = useCallback(async () => {
    if (!spreadsheetId) return;
    try {
      const data = await getSheetData(spreadsheetId, "Auction-Status!A2");
      if (data.values && data.values[0]) {
        setAuctionState(parseAuctionState(data.values[0][0]));
      }
    } catch (e) {
      console.error("Error fetching auction status:", e);
    }
  }, [spreadsheetId]);

  /** Whether "Set Up Bid Management App" has been run (its Bid-Management tab exists). Left unknown if the check fails. */
  const fetchSetupStatus = useCallback(async () => {
    if (!spreadsheetId) return;
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bidders/setup-status?spreadsheetId=${encodeURIComponent(spreadsheetId)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setIsBidManagementSetUp(!!(await res.json()).setUp);
    } catch (e) {
      console.error("Error checking whether Bid Management is set up:", e);
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
      setAuctionState("closed");
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

  /**
   * Moves Prep -> Live. The server refuses from any other state (409), so a
   * stale page can't undo a close. Returns whether it succeeded; never throws.
   */
  const requestGoLive = useCallback(async (): Promise<boolean> => {
    if (!spreadsheetId) return false;
    try {
      await postJson("/api/auction/go-live", { spreadsheetId }, "Failed to take the auction live");
      setAuctionState("live");
      toast.success("The auction is now Live.");
      return true;
    } catch (e: any) {
      console.error("Error taking the auction live:", e);
      toast.error("Failed to take the auction live: " + e.message);
      return false;
    }
  }, [spreadsheetId]);

  return { auctionState, isAuctionClosed, isBidManagementSetUp, fetchSetupStatus, fetchAuctionStatus, requestCloseAuction, requestGoLive };
}
