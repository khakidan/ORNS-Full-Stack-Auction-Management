import { useCallback, useEffect, useState } from "react";
import { checkWebsiteTicketsNow, getTicketPurchaseStatus, markLateWebsitePurchaseHandled } from "@/services/google-api";
import { TicketPurchaseStatus } from "@/types";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 60000;

export type TicketPurchaseStatusState = ReturnType<typeof useTicketPurchaseStatus>;

/**
 * Drives the Tickets page's Website Ticket Check tab (ROADMAP W6): the last
 * webhook, the poll's last runs and what needs staff. Refreshes every
 * minute while `enabled` (staff who can see the tab); "Check now" runs the
 * poll on demand and calls `onAdded` when it added a row, so the attendee
 * list catches up.
 */
export function useTicketPurchaseStatus(onAdded?: () => void, enabled = true) {
  const [status, setStatus] = useState<TicketPurchaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await getTicketPurchaseStatus());
    } catch (e) {
      console.error("[useTicketPurchaseStatus] Failed to fetch status:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh, enabled]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const run = await checkWebsiteTicketsNow();
      if (run.errors.length > 0) {
        toast.error(`The check stopped: ${run.errors[0]}`);
      } else {
        const added = run.mode === "write" ? run.added.length : run.wouldAdd.length;
        const confirmed = run.mode === "write" ? run.paymentsSet.length : run.paymentsWouldSet.length;
        const verb = run.mode === "write" ? "" : " (shadow mode - nothing written)";
        toast.success(`Checked the website: ${run.newEntries} new, ${added} missing from the sheet, ${confirmed} payment(s) confirmed${verb}.`);
      }
      if (run.added.length > 0 || run.paymentsSet.length > 0) onAdded?.();
      await refresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to check the website's ticket purchases");
    } finally {
      setChecking(false);
    }
  };

  /** W7: a purchase that arrived after Go Live was registered as a walk-in. */
  const markHandled = async (entryId: string) => {
    try {
      await markLateWebsitePurchaseHandled(entryId);
      toast.success("Marked as registered.");
      await refresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to mark the purchase as registered");
    }
  };

  return { status, loading, checking, checkNow, markHandled };
}
