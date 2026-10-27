import { useCallback, useEffect, useState } from "react";
import { getPaypalSweeperStatus, runPaypalSweepNow } from "@/services/google-api";
import { SweeperStatus } from "@/types";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 30000;

/**
 * Drives the Settings page's PayPal sweeper status card - the only
 * way to confirm, from inside the app rather than server logs, that the
 * two manual-only steps from Code Hardening item #2 have actually
 * happened: an admin signing in once (credentialConfigured) and the
 * background job running reliably (lastRunAt/lastResult). See
 * docs/agents/CHANGELOG.md.
 *
 * Polls every 30s (independent of the sweeper's own 5-minute interval) so
 * the card catches up reasonably quickly after a "Run Sweep Now" or a
 * fresh sign-in, without hammering the endpoint.
 */
export function usePaypalSweeperStatus() {
  const [status, setStatus] = useState<SweeperStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await getPaypalSweeperStatus();
      setStatus(result);
    } catch (e) {
      console.error("[usePaypalSweeperStatus] Failed to fetch status:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const runNow = async () => {
    setRunning(true);
    try {
      const result = await runPaypalSweepNow();
      if ("skipped" in result) {
        toast.info(`Sweep skipped: ${result.skipped}`);
      } else {
        toast.success(`Sweep complete: ${result.pending} pending, ${result.resolved} resolved, ${result.escalated} escalated.`);
      }
      await refresh();
    } catch (e: any) {
      toast.error(e.message || "Failed to run PayPal sweep");
    } finally {
      setRunning(false);
    }
  };

  return { status, loading, running, runNow };
}
