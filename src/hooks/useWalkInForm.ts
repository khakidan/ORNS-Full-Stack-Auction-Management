import { useState } from "react";
import { toast } from "sonner";
import { postJson } from "@/services/apiClient";

interface UseWalkInFormArgs {
  fetchBidders: () => Promise<void>;
  fetchAttendees: () => Promise<void>;
  spreadsheetId: string;
  ticketsSpreadsheetId: string;
  ticketPrice: string;
  bidManagementSheet: string;
  bidderNumbersSheet: string;
}

/**
 * The walk-in ticket dialog: its form, and registering the walk-in (a new
 * bidder number plus a ticket row). Split out of useBiddersState.ts.
 */
export function useWalkInForm({ fetchBidders, fetchAttendees, spreadsheetId, ticketsSpreadsheetId, ticketPrice, bidManagementSheet, bidderNumbersSheet }: UseWalkInFormArgs) {
  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [isSubmittingWalkIn, setIsSubmittingWalkIn] = useState(false);
  const [walkInForm, setWalkInForm] = useState({ firstName: "", lastName: "", email: "" });

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
      const result = await postJson("/api/bidders/walk-in", {
        ...walkInForm,
        spreadsheetId,
        ticketsSpreadsheetId,
        ticketPrice: ticketPrice,
        bidderNumbersSheet,
        bidManagementSheet,
        idempotencyKey
      }, "Failed to create walk-in ticket");
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

  return { isWalkInOpen, setIsWalkInOpen, isSubmittingWalkIn, walkInForm, setWalkInForm, handleWalkInSubmit };
}
