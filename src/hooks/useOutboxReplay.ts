import { useEffect } from "react";
import { flushOutbox, useBidOutbox } from "@/lib/bidOutbox";

export const OUTBOX_RETRY_INTERVAL_MS = 30 * 1000;

/**
 * Sends saved bids (src/lib/bidOutbox.ts) whenever there's a chance they'll
 * get through: on sign-in, when the browser comes back online, when the tab
 * becomes visible again, and every 30 seconds while any are waiting. Also
 * asks before the tab closes with bids still waiting. Mounted once, in App.
 */
export function useOutboxReplay(authenticated: boolean): void {
  const { entries } = useBidOutbox();
  const unsent = entries.filter((e) => e.status !== "needsReview").length;

  useEffect(() => {
    if (!authenticated) return;
    flushOutbox();
    const onOnline = () => flushOutbox();
    const onVisible = () => {
      if (document.visibilityState === "visible") flushOutbox();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || unsent === 0) return;
    const timer = setInterval(() => flushOutbox(), OUTBOX_RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [authenticated, unsent]);

  useEffect(() => {
    if (unsent === 0) return;
    // The bids would survive on this device, but only here - so check first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsent]);
}
