import { useState } from "react";
import { toast } from "sonner";
import { errorTextFrom, getBaseUrl, NO_ANSWER_MESSAGE, postOnce, ServerUnreachableError } from "@/services/google-api";
import { postJson } from "@/services/apiClient";

interface UseCheckoutBatchActionsArgs {
  spreadsheetId: string;
  itemsSpreadsheetId: string;
  folderId: string;
  bidderNumbersSheet: string;
  bidManagementSheet: string;
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
export function useCheckoutBatchActions({ spreadsheetId, itemsSpreadsheetId, folderId, bidderNumbersSheet, bidManagementSheet }: UseCheckoutBatchActionsArgs) {
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [isEmailingAll, setIsEmailingAll] = useState(false);
  const [showPrintConfirm, setShowPrintConfirm] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);

  /**
   * Prints every winner's receipt in parts (one PDF per part, see the
   * server's /generate-all), asking for part 1, 2, ... in turn and showing
   * progress. Each request is sent once, never retried - a retry after a
   * timeout started a second copy of the whole batch. Stops at the first
   * part that fails and says which parts were made.
   */
  const startBatchPrint = async () => {
    setShowPrintConfirm(false);
    const toastId = "batch-print";
    let done = 0;
    let totalParts = 1;
    try {
      setIsPrintingAll(true);

      for (let part = 1; part <= totalParts; part++) {
        toast.loading(totalParts > 1 ? `Printing receipts: part ${part} of ${totalParts}...` : "Printing receipts...", { id: toastId });
        const res = await postOnce(`${getBaseUrl()}/api/receipts/generate-all`, {
          spreadsheetId, itemsSpreadsheetId, bidderNumbersSheet, bidManagementSheet, receiptFolderId: folderId, part
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) throw new Error(errorTextFrom(data, "Batch generation failed"));

        if (data.totalParts === 0) {
          toast.info("No bidders have winning items yet, so there are no receipts to print.", { id: toastId });
          return;
        }
        totalParts = data.totalParts;
        done = part;
      }

      toast.success(
        totalParts === 1
          ? "Receipts printed. They're in your Receipts folder."
          : `All ${totalParts} parts of the receipts printed. They're in your Receipts folder.`,
        { id: toastId }
      );
    } catch (error: any) {
      console.error("[Checkout] Batch print error:", error);
      const reason = error instanceof ServerUnreachableError ? NO_ANSWER_MESSAGE : (error.message || "An unexpected error occurred during batch printing");
      const progress = done > 0 ? ` Parts 1-${done} of ${totalParts} were printed; part ${done + 1} was not.` : "";
      toast.error(`${reason}${progress}`, { id: toastId, duration: Infinity });
    } finally {
      setIsPrintingAll(false);
    }
  };

  const startBatchEmail = async () => {
    setShowEmailConfirm(false);
    try {
      setIsEmailingAll(true);

      console.log("[Checkout] Starting batch email...");
      // idempotencyKey: the request is retried on a timeout/5xx with this
      // same body, and the server joins that retry to the run already in
      // progress instead of starting a second one.
      const data = await postJson("/api/receipts/email-all",
        { spreadsheetId, itemsSpreadsheetId, bidderNumbersSheet, bidManagementSheet, idempotencyKey: window.crypto.randomUUID() },
        "Batch email failed");
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
