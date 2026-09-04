import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { getErrorBuffer } from "@/lib/errorBuffer";
import { formatAppState, formatBrowserInfo, formatConsoleActivity, getCurrentRoute } from "@/lib/bugReportContext";
import { blobToBase64, captureScreenshot } from "@/lib/screenshotCapture";
import { BugReportType } from "@/types";

export interface BugReportFormState {
  title: string;
  description: string;
  type: BugReportType;
  includeScreenshot: boolean;
}

const EMPTY_FORM: BugReportFormState = {
  title: "",
  description: "",
  type: "Bug",
  includeScreenshot: true,
};

/**
 * Owns the bug-report dialog's open state (button click + the global
 * Ctrl/Cmd+Shift+B shortcut), the form fields, and the submit flow: best-
 * effort screenshot capture, auto-captured app/browser/console context,
 * then POST /api/bug-reports. The server always saves the report one way
 * or another (the configured Bug-Reports spreadsheet, or a local .md
 * fallback file if that write fails) - a screenshot failure or a missing
 * spreadsheet ID must never block the report itself from saving, so this
 * hook never throws out of handleSubmit on those paths.
 */
export function useBugReportState() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BugReportFormState>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { bidders, items, attendees, winners, isAuctionClosed } = useAuction();
  const { config } = useConfig();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const resetForm = () => setForm(EMPTY_FORM);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) resetForm();
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error("Title and description are required");
      return;
    }

    setIsSubmitting(true);
    try {
      let screenshotBase64: string | null = null;
      if (form.includeScreenshot) {
        const blob = await captureScreenshot();
        if (blob) {
          screenshotBase64 = await blobToBase64(blob);
        }
      }

      const appState = formatAppState({
        biddersCount: bidders.length,
        itemsCount: items.length,
        attendeesCount: attendees.length,
        winnersCount: Object.keys(winners).length,
        isAuctionClosed,
        bidManagementSpreadsheetConfigured: !!config.bidManagementSpreadsheetId,
        auctionItemsSpreadsheetConfigured: !!config.auctionItemsSpreadsheetId,
        auctionTicketsSpreadsheetConfigured: !!config.auctionTicketsSpreadsheetId,
      });

      const res = await fetchWithRetry(`${getBaseUrl()}/api/bug-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          type: form.type,
          timestamp: new Date().toISOString(),
          route: getCurrentRoute(),
          appState,
          browserInfo: formatBrowserInfo(),
          consoleActivity: getErrorBuffer(),
          screenshotBase64,
          bugReportsSpreadsheetId: config.bugReportsSpreadsheetId,
          bugReportsFolderId: config.bugReportsFolderId,
        }),
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save bug report");
      }

      toast.success("Bug report saved");
      setOpen(false);
      resetForm();
    } catch (error: any) {
      console.error("[BugReport] Failed to submit:", error);
      toast.error(error.message || "Failed to save bug report");
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    open,
    setOpen: handleOpenChange,
    form,
    setForm,
    isSubmitting,
    handleSubmit,
  };
}
