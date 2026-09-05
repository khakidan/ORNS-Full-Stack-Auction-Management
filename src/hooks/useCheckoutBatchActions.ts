import { useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";

interface UseCheckoutBatchActionsArgs {
  spreadsheetId: string;
  itemsSpreadsheetId: string;
  folderId: string;
}

/**
 * Batch print/email actions for the checkout screen (generate receipts
 * for every winner, or email every winner their receipt), plus the
 * confirmation-dialog state each one opens behind. Split out of
 * useCheckoutState.ts (was 416 lines) so that container stays focused on
 * composing the split-out pieces.
 */
export function useCheckoutBatchActions({ spreadsheetId, itemsSpreadsheetId, folderId }: UseCheckoutBatchActionsArgs) {
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [isEmailingAll, setIsEmailingAll] = useState(false);
  const [showPrintConfirm, setShowPrintConfirm] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);

  const startBatchPrint = async () => {
    setShowPrintConfirm(false);
    try {
      setIsPrintingAll(true);

      console.log("[Checkout] Starting batch print...");
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/generate-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, receiptFolderId: folderId }),
        credentials: "include"
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Batch generation failed");
      toast.success("Batch receipt generation started! Check your Receipts folder in a few minutes.");
    } catch (error: any) {
      console.error("[Checkout] Batch print error:", error);
      toast.error(error.message || "An unexpected error occurred during batch printing");
    } finally {
      setIsPrintingAll(false);
    }
  };

  const startBatchEmail = async () => {
    setShowEmailConfirm(false);
    try {
      setIsEmailingAll(true);

      console.log("[Checkout] Starting batch email...");
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/email-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, itemsSpreadsheetId }),
        credentials: "include"
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Batch email failed");
      toast.success("Batch emails are being sent! Check your Sent folder in a few minutes.");
    } catch (error: any) {
      console.error("[Checkout] Batch email error:", error);
      toast.error(error.message || "An unexpected error occurred during batch emailing");
    } finally {
      setIsEmailingAll(false);
    }
  };

  return {
    isPrintingAll,
    showPrintConfirm,
    setShowPrintConfirm,
    startBatchPrint,

    isEmailingAll,
    showEmailConfirm,
    setShowEmailConfirm,
    startBatchEmail,
  };
}
