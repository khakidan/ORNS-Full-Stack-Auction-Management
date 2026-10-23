import { useState } from "react";
import { toast } from "sonner";
import { errorTextFrom, getBaseUrl, NO_ANSWER_MESSAGE, postOnce, ServerUnreachableError } from "@/services/google-api";
import type { WinnerRecord } from "./useCheckoutState";
import { postJson } from "@/services/apiClient";

interface UseCheckoutReceiptActionsArgs {
  spreadsheetId: string;
  itemsSpreadsheetId: string;
  folderId: string;
  bidderNumbersSheet: string;
  bidManagementSheet: string;
}

/**
 * Per-winner receipt actions for the checkout screen (email/print one
 * bidder's receipt). Split out of useCheckoutState.ts (was 416 lines) so
 * that container stays focused on composing the split-out pieces.
 */
export function useCheckoutReceiptActions({ spreadsheetId, itemsSpreadsheetId, folderId, bidderNumbersSheet, bidManagementSheet }: UseCheckoutReceiptActionsArgs) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleEmailReceipt = async (winner: WinnerRecord) => {
    setProcessingId(`${winner.bidderId}-email`);
    try {
      await postJson("/api/receipts/email-only", {
        bidderId: winner.bidderId,
        spreadsheetId,
        itemsSpreadsheetId,
        bidderNumbersSheet,
        bidManagementSheet
      }, "Failed to send email");
      toast.success(`Receipt emailed to ${winner.name}`);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handlePrintReceipt = async (winner: WinnerRecord) => {
    setProcessingId(`${winner.bidderId}-print`);
    try {
      // Sent once, never retried: a retry after a timeout made a second
      // copy of the receipt PDF.
      const res = await postOnce(`${getBaseUrl()}/api/receipts/generate`, {
        bidderId: winner.bidderId,
        spreadsheetId,
        itemsSpreadsheetId,
        bidderNumbersSheet,
        bidManagementSheet,
        receiptFolderId: folderId
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(errorTextFrom(data, "Failed to generate Google Doc"));
      }

      toast.success(`Receipt Doc created! Subtotal: $${data.subtotal}`);
      if (data.paymentUrl) {
        console.log(`Payment URL: ${data.paymentUrl}`);
      }
      if (data.docId) {
        window.open(`https://docs.google.com/document/d/${data.docId}/edit`, '_blank');
      }
    } catch (error: any) {
      toast.error(error instanceof ServerUnreachableError ? NO_ANSWER_MESSAGE : error.message);
    } finally {
      setProcessingId(null);
    }
  };

  return { processingId, handleEmailReceipt, handlePrintReceipt };
}
