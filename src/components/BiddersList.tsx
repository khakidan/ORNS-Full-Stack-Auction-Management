import { UserCheck } from "lucide-react";
import { RowListShell } from "@/components/RowListShell";
import { BidderRow } from "@/components/BidderRow";
import { Bidder } from "@/types";
import { BidderAttendeeInfo } from "@/lib/bidderAttendeeInfo";

interface BiddersListProps {
  bidders: Bidder[];
  loading: boolean;
  /** Unfiltered bidder count, so the empty state can tell "nothing loaded yet" apart from "filtered down to nothing" - matches Items.tsx's own search/no-data distinction. */
  totalBiddersCount: number;
  hasActiveFilters: boolean;
  getAttendeeInfo: (bidder: Bidder) => BidderAttendeeInfo;
  isAuctionClosed: boolean;
  processingId: string | null;
  isAddingTicketToReceipt: boolean;
  onCheckInAttempt: (bidder: Bidder) => void;
  onMarkAsProxy: (bidder: Bidder) => void;
}

/**
 * Row-based replacement for the old <table>-based BiddersTable.tsx (see
 * CHANGELOG.md's "UI / Layout Tweaks" item), matching
 * AttendeesList.tsx's plain-div-list pattern - a flexible row can show
 * more per bidder without the awkward narrow-column squeeze a <table>
 * forces. Column-header sorting moved to a "Sort by" control in
 * BiddersFilterControls.tsx, since there's no table header left to click.
 */
export function BiddersList({
  bidders,
  loading,
  totalBiddersCount,
  hasActiveFilters,
  getAttendeeInfo,
  isAuctionClosed,
  processingId,
  isAddingTicketToReceipt,
  onCheckInAttempt,
  onMarkAsProxy,
}: BiddersListProps) {
  return (
    <RowListShell
      items={bidders}
      loading={loading}
      animated
      emptyIcon={<UserCheck className="w-7 h-7" />}
      emptyMessage={
        totalBiddersCount === 0
          ? 'No bidders loaded yet. Run "Set Up Bid Management App" or add a walk-in ticket to get started.'
          : hasActiveFilters
            ? "No bidders match your search or filters."
            : "No bidders found."
      }
      renderRow={(bidder) => (
        <BidderRow
          key={bidder.id}
          bidder={bidder}
          attendeeInfo={getAttendeeInfo(bidder)}
          isAuctionClosed={isAuctionClosed}
          processingId={processingId}
          isAddingTicketToReceipt={isAddingTicketToReceipt}
          onCheckInAttempt={onCheckInAttempt}
          onMarkAsProxy={onMarkAsProxy}
        />
      )}
    />
  );
}
