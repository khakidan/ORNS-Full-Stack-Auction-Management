import { useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import type { WinnerRecord } from "./useCheckoutState";

interface UseCheckoutReceiptActionsArgs {
  spreadsheetId: string;
  itemsSpreadsheetId: string;
  folderId: string;
}

/**
 * Per-winner receipt actions for the checkout screen (email/print one
 * bidder's receipt). Split out of useCheckoutState.ts (was 416 lines) so
 * that container stays focused on composing the split-out pieces.
 */
export function useCheckoutReceiptActions({ spreadsheetId, itemsSpreadsheetId, folderId }: UseCheckoutReceiptActionsArgs) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleEmailReceipt = async (winner: WinnerRecord) => {
    setProcessingId(`${winner.bidderId}-email`);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/email-only`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidderId: winner.bidderId,
          spreadsheetId,
          itemsSpreadsheetId
        }),
        credentials: "include"
      });

      if (!res.ok) throw new Error("Failed to send email");
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
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidderId: winner.bidderId,
          emailReceipt: false,
          spreadsheetId,
          receiptFolderId: folderId
        }),
        credentials: "include"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate Google Doc");
      }

      const data = await res.json();
      toast.success(`Receipt Doc created! Subtotal: $${data.subtotal}`);
      if (data.paymentUrl) {
        console.log(`Payment URL: ${data.paymentUrl}`);
      }
      if (data.docId) {
        window.open(`https://docs.google.com/document/d/${data.docId}/edit`, '_blank');
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setProcessingId(null);
    }
  };

  return { processingId, handleEmailReceipt, handlePrintReceipt };
}
