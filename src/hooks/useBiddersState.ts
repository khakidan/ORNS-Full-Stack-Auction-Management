import { useState } from "react";
import { toast } from "sonner";
import { getBidderAttendeeInfo } from "@/lib/bidderAttendeeInfo";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { Bidder, Attendee } from "@/types";
import { postJson } from "@/services/apiClient";
import { useBidderFilters } from "./useBidderFilters";
import { useWalkInForm } from "./useWalkInForm";

export type { BidderSortKey, BidderSortConfig } from "./useBidderFilters";

interface UseBiddersStateArgs {
  bidders: Bidder[];
  attendees: Attendee[];
  checkInBidder: (bidder: Bidder) => Promise<void>;
  markBidderAsProxy: (bidder: Bidder) => Promise<void>;
  fetchBidders: () => Promise<void>;
  fetchAttendees: () => Promise<void>;
  spreadsheetId: string;
  ticketsSpreadsheetId: string;
  ticketPrice: string;
  bidManagementSheet: string;
  bidderNumbersSheet: string;
}

/**
 * Owns all list-level state and mutation handlers for the bidder
 * check-in table: check-in/proxy actions and the pending-payment
 * confirmation flow, composing the search/filter/sort
 * (useBidderFilters.ts) and the walk-in ticket form (useWalkInForm.ts).
 * Kept separate from Bidders.tsx so that component stays focused on
 * composing/rendering the split-out pieces.
 */
export function useBiddersState({
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
}: UseBiddersStateArgs) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pendingCheckIn, setPendingCheckIn] = useState<Bidder | null>(null);
  const [isAddingTicketToReceipt, setIsAddingTicketToReceipt] = useState(false);
  const filters = useBidderFilters(bidders, attendees);
  const walkIn = useWalkInForm({ fetchBidders, fetchAttendees, spreadsheetId, ticketsSpreadsheetId, ticketPrice, bidManagementSheet, bidderNumbersSheet });

  const getAttendeeInfo = (bidder: Bidder) => getBidderAttendeeInfo(bidder, attendees);

  const handleConfirmCheckInClick = async (bidder: Bidder) => {
    setProcessingId(bidder.id);
    await checkInBidder(bidder);
    setProcessingId(null);
  };

  const handleCheckInAttempt = (bidder: Bidder) => {
    const { attendee, isGuest } = getAttendeeInfo(bidder);

    if (!isGuest && attendee && attendee.paymentStatus.toLowerCase() === 'pending') {
      setPendingCheckIn(bidder);
    } else {
      handleConfirmCheckInClick(bidder);
    }
  };

  const confirmPendingCheckIn = async (addToReceipt: boolean) => {
    if (!pendingCheckIn) return;

    if (addToReceipt) {
      const idempotencyKey = crypto.randomUUID();
      const bidderId = pendingCheckIn.id;
      const originalBidder = pendingCheckIn;

      setProcessingId(bidderId);
      setIsAddingTicketToReceipt(true);

      try {
        await postJson("/api/auction/check-in-with-bid", {
          bidderId: originalBidder.id,
          spreadsheetId,
          bidManagementSheet,
          bidderNumbersSheet,
          bidValue: parseFloat(ticketPrice) || 35,
          idempotencyKey
        }, "Transactional check-in failed");

        toast.success(`Check-in complete and ticket added to ${originalBidder.firstName}'s receipt`);
        await fetchBidders();
      } catch (err: any) {
        console.error("Check-in error:", err);
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
        await fetchBidders();
      } finally {
        setProcessingId(null);
        setIsAddingTicketToReceipt(false);
        setPendingCheckIn(null);
      }
    } else {
      await handleConfirmCheckInClick(pendingCheckIn);
      setPendingCheckIn(null);
    }
  };

  const markAsProxy = async (bidder: Bidder) => {
    setProcessingId(bidder.id);
    await markBidderAsProxy(bidder);
    setProcessingId(null);
  };

  return {
    // Search/filter/sort
    ...filters,
    getAttendeeInfo,

    // Check-in / proxy
    processingId,
    handleCheckInAttempt,
    markAsProxy,

    // Pending payment confirmation
    pendingCheckIn,
    setPendingCheckIn,
    isAddingTicketToReceipt,
    confirmPendingCheckIn,

    // Walk-in ticket dialog
    ...walkIn,
  };
}
