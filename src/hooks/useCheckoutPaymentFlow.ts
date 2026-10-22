import { useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { Bidder, Attendee } from "@/types";
import type { WinnerRecord } from "./useCheckoutState";

interface UseCheckoutPaymentFlowArgs {
  bidders: Bidder[];
  attendees: Attendee[];
  setWinners: React.Dispatch<React.SetStateAction<WinnerRecord[]>>;
  specialWinners: { name: string; bidderId: string }[];
  fetchAllData: () => Promise<void>;
  spreadsheetId: string;
  itemsSpreadsheetId: string;
  ticketsSpreadsheetId: string;
  bidderNumbersSheet: string;
  bidManagementSheet: string;
}

/**
 * The mark-paid flow for the checkout screen: the high-value-alert gate,
 * the payment-method dialog, and the optimistic-update/background-sync/
 * scoped-rollback mutation itself. Split out of useCheckoutState.ts (was
 * 416 lines) so that container stays focused on composing the split-out
 * pieces. Reads/writes the winners list via `setWinners` and
 * `specialWinners`, both owned by useWinnersList.ts - the same
 * one-hook's-setter-passed-into-another composition pattern already used
 * in AuctionContext.tsx.
 */
export function useCheckoutPaymentFlow({
  bidders,
  attendees,
  setWinners,
  specialWinners,
  fetchAllData,
  spreadsheetId,
  itemsSpreadsheetId,
  ticketsSpreadsheetId,
  bidderNumbersSheet,
  bidManagementSheet,
}: UseCheckoutPaymentFlowArgs) {
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [winnerToPay, setWinnerToPay] = useState<WinnerRecord | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  const handleMarkPaid = (winner: WinnerRecord) => {
    // Check for high-value items in Special-Winners sheet
    const alertItems = specialWinners.filter(sw => sw.bidderId === winner.bidderId);

    if (alertItems.length > 0) {
      const itemNames = alertItems.map(i => i.name).join(" and ");
      toast.warning(`High-Value Alert: ${itemNames}`, {
        description: `Ensure this bidder has received their ${itemNames} prize before completing checkout.`,
        duration: Infinity,
        action: {
          label: "I have confirmed",
          onClick: () => {
            setWinnerToPay(winner);
            setPaymentMethod("");
            setShowPaymentDialog(true);
          }
        }
      });
      return;
    }

    setWinnerToPay(winner);
    setPaymentMethod("");
    setShowPaymentDialog(true);
  };

  const confirmMarkPaid = async () => {
    if (!winnerToPay || !paymentMethod) {
      toast.error("Please select a payment method");
      return;
    }

    if (!spreadsheetId) {
      toast.error("Bid Management Spreadsheet ID not configured correctly.");
      return;
    }

    setIsSubmittingPayment(true);
    const winner = winnerToPay;

    // Apps Script's recordPayment() does an exact-case match against these
    // lowercase values (confirmed against Class_GoogleAIStudio.gs and the
    // team's own manual API_PAYPAL_TESTS.gs) - anything else throws
    // "Unknown checkout payment method specified" and rolls back.
    let mappedMethod = "cash";
    if (paymentMethod === "Cash") mappedMethod = "cash";
    else if (paymentMethod === "Check") mappedMethod = "check";
    else if (paymentMethod === "Credit Card/PayPal") mappedMethod = "credit_card";

    const method = paymentMethod;

    // Just this winner's previous paid/paymentPending values, not a whole
    // captured array snapshot - a second winner marked paid while this
    // one is still in flight must not be erased by this rollback.
    const previousWinnerState = { paid: winner.paid, paymentPending: winner.paymentPending };
    const bidderInfo = bidders.find(b => b.id === winner.bidderId);

    // Perform optimistic update locally immediately
    setWinners(prev => prev.map(w => {
      if (w.bidderId === winner.bidderId) {
        return { ...w, paid: mappedMethod !== "credit_card", paymentPending: mappedMethod === "credit_card" };
      }
      return w;
    }));

    const attendee = ticketsSpreadsheetId && attendees.find(a =>
      bidderInfo &&
      a.firstName.trim().toLowerCase() === bidderInfo.firstName.trim().toLowerCase() &&
      a.lastName.trim().toLowerCase() === bidderInfo.lastName.trim().toLowerCase()
    );

    const idempotencyKey = crypto.randomUUID();

    // Close dialog immediately
    setShowPaymentDialog(false);

    // Fire background sync
    fetchWithRetry(`${getBaseUrl()}/api/auction/checkout-mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bidderId: winner.bidderId,
        spreadsheetId,
        itemsSpreadsheetId,
        ticketsSpreadsheetId,
        bidderNumbersSheet,
        bidManagementSheet,
        attendeeInfo: attendee && attendee.sheet === 'tickets' ? { sheet: attendee.sheet, rowIndex: attendee.rowIndex } : null,
        paymentMethod: mappedMethod,
        amount: winner.total,
        idempotencyKey
      }),
      credentials: "include"
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to complete checkout transaction");
        }

        const data = await res.json();
        const bidderName = bidderInfo ? `${bidderInfo.firstName} ${bidderInfo.lastName}` : `Bidder ${winner.bidderId}`;

        if (res.status === 202 || data.deferred) {
          toast.info(`${bidderName} checkout sent. Pending PayPal background verification.`);
          setWinners(prev => prev.map(w => w.bidderId === winner.bidderId ? { ...w, paymentPending: true, paid: false } : w));
        } else {
          toast.success(`${bidderName} marked as Paid (${method})`);
          setWinners(prev => prev.map(w => w.bidderId === winner.bidderId ? { ...w, paymentPending: false, paid: true } : w));
        }
        // The payment is recorded in the sheet, but something staff must
        // act on still went wrong - e.g. PayPal didn't take the cash/check
        // payment, so the bidder's invoice is still open and payable.
        if (data.warning) toast.warning(data.warning, { duration: 15000 });

        fetchAllData(); // Refresh all data to ensure sync
      })
      .catch((error: any) => {
        console.error("[Checkout] Sync error:", error);
        setWinners(prev => prev.map(w => w.bidderId === winner.bidderId ? { ...w, ...previousWinnerState } : w));
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      })
      .finally(() => {
        setIsSubmittingPayment(false);
        setWinnerToPay(null);
      });
  };

  return {
    showPaymentDialog,
    setShowPaymentDialog,
    winnerToPay,
    paymentMethod,
    setPaymentMethod,
    isSubmittingPayment,
    handleMarkPaid,
    confirmMarkPaid,
  };
}
