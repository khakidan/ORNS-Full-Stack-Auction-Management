import { useAuction } from "@/context/AuctionContext";
import { useAuth } from "@/context/AuthContext";

/**
 * Whether Bid Management is read-only for this person: the auction is
 * Closed and they can't work on it after Close ("auction.afterClose" -
 * Administrators and Full Administrators can, so the close-out report's
 * tasks can be finished). Checkout and Receipts stay open to everyone.
 */
export function useClosedReadOnly(): boolean {
  const { isAuctionClosed } = useAuction();
  const { can } = useAuth();
  return isAuctionClosed && !can("auction.afterClose");
}
