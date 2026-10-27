import { useCallback, useEffect, useRef } from "react";
import { getBaseUrl } from "@/services/google-api";

const POLL_MS = 5000;

/**
 * Live refresh: asks the server every few seconds (while this tab is
 * visible) what changed since it last looked - GET /api/changes, which
 * answers from memory without touching Google (server/utils/changeFeed.ts)
 * - and calls `onChange` with the changed keys (spreadsheet IDs, or
 * "action-history"). `reset` means the server restarted and anything may
 * have changed. Returns `checkNow`, for right after an action (an Undo)
 * whose effect this tab should show without waiting.
 *
 * Plain fetch, not fetchWithRetry: a missed check is simply retried on the
 * next tick, and must not show the "saving..." sync banner.
 */
export function useChangeFeed(enabled: boolean, onChange: (changed: Set<string>, reset: boolean) => void): () => Promise<void> {
  const since = useRef<number | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const inFlight = useRef(false);

  const checkNow = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`${getBaseUrl()}/api/changes?since=${since.current ?? 0}`, { credentials: "include" });
      if (!res.ok) return;
      const data: { version: number; changed: string[]; reset: boolean } = await res.json();
      const first = since.current === null;
      since.current = data.version;
      // The first answer only sets the starting point - the page has just loaded everything.
      if (!first && (data.reset || data.changed.length > 0)) callback.current(new Set(data.changed), data.reset);
    } catch {
      // Offline or the server is restarting - the next tick tries again.
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      since.current = null;
      return;
    }
    checkNow();
    const tick = () => {
      if (document.visibilityState === "visible") checkNow();
    };
    const interval = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, checkNow]);

  return checkNow;
}
