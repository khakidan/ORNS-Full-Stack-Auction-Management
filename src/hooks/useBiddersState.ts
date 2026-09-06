import { useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { getBidderAttendeeInfo } from "@/lib/bidderAttendeeInfo";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { Bidder, Attendee } from "@/types";

// The only three keys sortedBidders' comparator below actually handles -
// narrowing sortConfig to this literal union (instead of a bare `string`)
// is what lets valA/valB below be typed `string | number` instead of
// `any`: any other key would previously fall through every branch
// silently leaving valA/valB `undefined`, sorting nothing, with no
// compiler signal that the key was never handled. Not reachable today
// (BiddersFilterControls.tsx's "Sort by" select is the only caller, and
// it only ever sets these three), but this makes that guarantee checked
// at compile time instead of merely true by inspection.
export type BidderSortKey = "id" | "name" | "status";

export interface BidderSortConfig {
  key: BidderSortKey;
  direction: "asc" | "desc";
}

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
 * check-in table: search/filter/sort, check-in/proxy actions, the
 * pending-payment confirmation flow, and the walk-in ticket form. Kept
 * separate from Bidders.tsx so that component stays focused on
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
  const [searchTerm, setSearchTerm] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [isSubmittingWalkIn, setIsSubmittingWalkIn] = useState(false);
  const [walkInForm, setWalkInForm] = useState({ firstName: "", lastName: "", email: "" });

  const [pendingCheckIn, setPendingCheckIn] = useState<Bidder | null>(null);
  const [isAddingTicketToReceipt, setIsAddingTicketToReceipt] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const [sortConfig, setSortConfig] = useState<BidderSortConfig | null>({
    key: "id",
    direction: "asc",
  });

  const getAttendeeInfo = (bidder: Bidder) => getBidderAttendeeInfo(bidder, attendees);

  const sortedBidders = useMemo(() => {
    const filtered = bidders.filter(b => {
      const matchesSearch =
        b.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.id.includes(searchTerm);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "checked-in" && b.checkedIn) ||
        (statusFilter === "pending" && !b.checkedIn && !b.isProxy) ||
        (statusFilter === "proxy" && b.isProxy);

      const { attendee, isGuest } = getBidderAttendeeInfo(b, attendees);

      const isPaid = isGuest || attendee?.paymentStatus.toLowerCase() === "paid";

      const matchesPayment =
        paymentFilter === "all" ||
        (paymentFilter === "paid" && isPaid) ||
        (paymentFilter === "pending" && !isPaid && !!attendee);

      const matchesSource =
        sourceFilter === "all" ||
        (sourceFilter === "general" && (!attendee || attendee.sheet === "tickets")) ||
        (sourceFilter === "sponsors" && attendee?.sheet === "sponsor tickets") ||
        (sourceFilter === "staff" && attendee?.sheet === "staff tickets");

      return matchesSearch && matchesStatus && matchesPayment && matchesSource;
    });

    return [...filtered].sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;

      let valA: string | number;
      let valB: string | number;

      if (key === "id") {
        valA = parseInt(a.id);
        valB = parseInt(b.id);
      } else if (key === "name") {
        valA = `${a.lastName} ${a.firstName}`.toLowerCase();
        valB = `${b.lastName} ${b.firstName}`.toLowerCase();
      } else if (key === "status") {
        // Sort status: Checked In (2) > Proxy (1) > Not Present (0)
        valA = a.checkedIn ? 2 : a.isProxy ? 1 : 0;
        valB = b.checkedIn ? 2 : b.isProxy ? 1 : 0;
      }

      if (valA < valB) return direction === "asc" ? -1 : 1;
      if (valA > valB) return direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [bidders, attendees, searchTerm, statusFilter, paymentFilter, sourceFilter, sortConfig]);

  // Distinguishes "nothing has ever loaded" from "filtered down to nothing" -
  // BiddersTable.tsx uses this to pick the right empty-state message,
  // matching Items.tsx's own search/no-data distinction.
  const hasActiveFilters = searchTerm !== "" || statusFilter !== "all" || paymentFilter !== "all" || sourceFilter !== "all";

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
        const res = await fetchWithRetry(`${getBaseUrl()}/api/auction/check-in-with-bid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bidderId: originalBidder.id,
            spreadsheetId,
            bidManagementSheet,
            bidderNumbersSheet,
            bidValue: parseFloat(ticketPrice) || 35,
            idempotencyKey
          }),
          credentials: "include"
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Transactional check-in failed");
        }

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

  const handleWalkInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walkInForm.firstName || !walkInForm.lastName) {
      toast.error("First and Last name are required");
      return;
    }

    setIsSubmittingWalkIn(true);
    const idempotencyKey = crypto.randomUUID();

    const loadingToastId = toast.loading(
      "Connecting to Google Sheets database... calculating new Bidder ID and modifying sheet structures.",
      { duration: Infinity }
    );

    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bidders/walk-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...walkInForm,
          spreadsheetId,
          ticketsSpreadsheetId,
          ticketPrice: ticketPrice,
          bidderNumbersSheet,
          bidManagementSheet,
          idempotencyKey
        }),
        credentials: "include"
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create walk-in ticket");
      }

      const result = await res.json();
      toast.success(
        `Success! Recorded Walk-In transaction in Google Sheets for ${result.bidder.firstName} ${result.bidder.lastName}.`,
        { id: loadingToastId, duration: 5000 }
      );

      if (ticketsSpreadsheetId && !result.ticketAppended) {
        console.warn("[Walk-in] Append failed:", result.appendError);
        toast.warning(`Bidder number created, but failed to append to Auction Tickets sheet: ${result.appendError || "Unknown sheet error"}. Staff should manually verify.`);
      }

      setIsWalkInOpen(false);
      setWalkInForm({ firstName: "", lastName: "", email: "" });
      fetchBidders();
      fetchAttendees(); // Sync attendees too
    } catch (error: any) {
      toast.error(`Error: ${error.message}`, { id: loadingToastId });
    } finally {
      setIsSubmittingWalkIn(false);
    }
  };

  return {
    // Search/filter/sort
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    paymentFilter,
    setPaymentFilter,
    sourceFilter,
    setSourceFilter,
    sortConfig,
    setSortConfig,
    sortedBidders,
    hasActiveFilters,
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
    isWalkInOpen,
    setIsWalkInOpen,
    isSubmittingWalkIn,
    walkInForm,
    setWalkInForm,
    handleWalkInSubmit,
  };
}
