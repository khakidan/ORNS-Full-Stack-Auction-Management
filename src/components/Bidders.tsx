// src/components/Bidders.tsx
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FilterToolbar } from "@/components/FilterToolbar";
import { BiddersFilterControls } from "@/components/BiddersFilterControls";
import { BiddersTable } from "@/components/BiddersTable";
import { WalkInTicketDialog } from "@/components/WalkInTicketDialog";
import { PendingPaymentDialog } from "@/components/PendingPaymentDialog";
import { useBiddersState } from "@/hooks/useBiddersState";

export default function Bidders() {
  const { bidders, loading, checkInBidder, markBidderAsProxy, fetchBidders, fetchAttendees, attendees, isAuctionClosed } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const ticketsSpreadsheetId = config.auctionTicketsSpreadsheetId;
  const ticketPrice = config.ticketPrice;
  const bidManagementSheet = config.bidManagementSheet;
  const bidderNumbersSheet = config.bidderNumbersSheet;

  const state = useBiddersState({
    bidders,
    attendees,
    checkInBidder,
    markBidderAsProxy,
    fetchBidders,
    fetchAttendees,
    spreadsheetId,
    ticketsSpreadsheetId,
    ticketPrice,
    bidManagementSheet,
    bidderNumbersSheet,
  });

  return (
    <div className="space-y-6">
      <FilterToolbar
        searchValue={state.searchTerm}
        onSearchChange={state.setSearchTerm}
        searchPlaceholder="Search bidders..."
        searchClassName="md:max-w-xs"
        searchInputClassName="h-10"
        filters={
          <BiddersFilterControls
            statusFilter={state.statusFilter}
            onStatusFilterChange={state.setStatusFilter}
            paymentFilter={state.paymentFilter}
            onPaymentFilterChange={state.setPaymentFilter}
            sourceFilter={state.sourceFilter}
            onSourceFilterChange={state.setSourceFilter}
          />
        }
        trailing={
          <>
            {!isAuctionClosed && (
              <WalkInTicketDialog
                open={state.isWalkInOpen}
                onOpenChange={state.setIsWalkInOpen}
                form={state.walkInForm}
                onFormChange={state.setWalkInForm}
                onSubmit={state.handleWalkInSubmit}
                isSubmitting={state.isSubmittingWalkIn}
              />
            )}
            {isAuctionClosed && (
              <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 px-4 h-10">
                Auction Closed (Read Only)
              </Badge>
            )}
          </>
        }
      />

      <Card>
        <CardHeader className="px-4 py-6 md:px-6">
          <CardTitle>Bidder Check-In</CardTitle>
          <CardDescription>
            Search by last name. Mark bidders as present or as proxy bidders.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <BiddersTable
            bidders={state.sortedBidders}
            loading={loading}
            sortConfig={state.sortConfig}
            onSort={state.handleSort}
            totalBiddersCount={bidders.length}
            hasActiveFilters={state.hasActiveFilters}
            getAttendeeInfo={state.getAttendeeInfo}
            isAuctionClosed={isAuctionClosed}
            processingId={state.processingId}
            isAddingTicketToReceipt={state.isAddingTicketToReceipt}
            onCheckInAttempt={state.handleCheckInAttempt}
            onMarkAsProxy={state.markAsProxy}
          />
        </CardContent>
      </Card>

      <PendingPaymentDialog
        pendingCheckIn={state.pendingCheckIn}
        onOpenChange={(open) => !open && state.setPendingCheckIn(null)}
        isAddingTicketToReceipt={state.isAddingTicketToReceipt}
        onConfirm={state.confirmPendingCheckIn}
      />
    </div>
  );
}
