import { useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";

interface UseCheckoutBatchActionsArgs {
  spreadsheetId: string;
  itemsSpreadsheetId: string;
  folderId: string;
}

/**
 * e.g. "Emailed 12 receipts. 30 already had this receipt and were skipped."
 * The server skips a bidder already emailed this same invoice, so a
 * second click is safe and reports what it skipped.
 */
function formatEmailAllSummary(data: { sentCount?: number; alreadySentCount?: number; failedCount?: number }): string {
  const sent = data.sentCount ?? 0;
  const parts = [`Emailed ${sent} receipt${sent === 1 ? "" : "s"}.`];
  if (data.alreadySentCount) parts.push(`${data.alreadySentCount} already had this receipt and were skipped.`);
  if (data.failedCount) parts.push(`${data.failedCount} could not be sent - check the bidders' email addresses.`);
  return parts.join(" ");
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
        body: JSON.stringify({ spreadsheetId, itemsSpreadsheetId, receiptFolderId: folderId }),
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
        // idempotencyKey: fetchWithRetry re-sends this same body on a
        // timeout/5xx, and the server joins that retry to the run already
        // in progress instead of starting a second one.
        body: JSON.stringify({ spreadsheetId, itemsSpreadsheetId, idempotencyKey: window.crypto.randomUUID() }),
        credentials: "include"
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "Batch email failed");
      toast.success(formatEmailAllSummary(data));
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
