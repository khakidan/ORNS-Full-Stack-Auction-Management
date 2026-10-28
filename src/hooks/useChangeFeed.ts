import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
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
 * Notices (an Undo, say) are shown as a toast on every screen except that
 * of `myEmail`, the person who caused them - theirs already said so.
 *
 * Plain fetch, not fetchWithRetry: a missed check is simply retried on the
 * next tick, and must not show the "saving..." sync banner.
 *
 * A 401 means this browser's sign-in ended while the tab was open (a
 * deploy that changed the session, an expired session, a volunteer's
 * access ending): `onSignedOut` is called - once, until a check succeeds
 * again - so the app re-checks its sign-in and shows the sign-in screen,
 * which also stops this polling. Without it the tab kept asking every 5
 * seconds and looked signed in until the next action failed.
 */
export function useChangeFeed(
  enabled: boolean,
  onChange: (changed: Set<string>, reset: boolean) => void,
  myEmail?: string,
  onSignedOut?: () => void
): () => Promise<void> {
  const since = useRef<number | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const me = useRef(myEmail);
  me.current = myEmail;
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;
  const reportedSignedOut = useRef(false);
  const inFlight = useRef(false);

  const checkNow = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`${getBaseUrl()}/api/changes?since=${since.current ?? 0}`, { credentials: "include" });
      if (res.status === 401) {
        if (!reportedSignedOut.current) {
          reportedSignedOut.current = true;
          signedOut.current?.();
        }
        return;
      }
      if (!res.ok) return;
      reportedSignedOut.current = false;
      const data: { version: number; changed: string[]; notices?: { message: string; by: string }[]; reset: boolean } = await res.json();
      const first = since.current === null;
      since.current = data.version;
      // The first answer only sets the starting point - the page has just loaded everything.
      if (first) return;
      for (const notice of data.notices ?? []) {
        if (notice.by !== me.current) toast.info(notice.message, { duration: 15000 });
      }
      if (data.reset || data.changed.length > 0) callback.current(new Set(data.changed), data.reset);
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
