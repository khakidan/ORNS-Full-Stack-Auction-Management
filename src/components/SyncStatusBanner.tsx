import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, LogIn, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearRecovered, useRetryStatus } from "@/lib/syncStatus";
import { removeFromOutbox, retryOutboxEntry, useBidOutbox } from "@/lib/bidOutbox";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const FLASH_MS = 4000;

type Tone = "warn" | "info" | "ok" | "bad";

const TONES: Record<Tone, { box: string; icon: string }> = {
  warn: { box: "bg-amber-50 border-amber-200 text-amber-950", icon: "text-amber-600" },
  info: { box: "bg-blue-50 border-blue-200 text-blue-950", icon: "text-blue-600" },
  ok: { box: "bg-emerald-50 border-emerald-200 text-emerald-950", icon: "text-emerald-600" },
  bad: { box: "bg-red-50 border-red-200 text-red-950", icon: "text-orns-red" },
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The connection banner above every page (ROADMAP.md Milestone A): shows,
 * one message at a time, the most important of
 *   saved bids the server refused > sign-in expired > offline >
 *   sending saved bids > saved bids waiting > Google retrying >
 *   "all sent" / "responding again" (briefly).
 * Hidden when everything is normal. A polite live region, so screen
 * readers announce changes without interrupting.
 */
export function SyncStatusBanner({ onSignIn }: { onSignIn: () => void }) {
  const retry = useRetryStatus();
  const outbox = useBidOutbox();
  const online = useOnlineStatus();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [, setTick] = useState(0);

  const review = outbox.entries.filter((e) => e.status === "needsReview");
  const unsent = outbox.entries.filter((e) => e.status !== "needsReview").length;
  const now = Date.now();
  const showCaughtUp = outbox.lastSentAt !== null && now - outbox.lastSentAt < FLASH_MS && unsent === 0 && !outbox.sending;
  const showRecovered = retry.recoveredAt !== null && now - retry.recoveredAt < FLASH_MS;

  // Re-render once a brief note has had its moment, so it disappears.
  useEffect(() => {
    if (!showCaughtUp && !showRecovered) return;
    const t = setTimeout(() => {
      if (showRecovered) clearRecovered();
      setTick((n) => n + 1);
    }, FLASH_MS);
    return () => clearTimeout(t);
  }, [showCaughtUp, showRecovered]);

  useEffect(() => {
    if (review.length === 0) setReviewOpen(false);
  }, [review.length]);

  let tone: Tone | null = null;
  let Icon = AlertCircle;
  let title = "";
  let detail = "";
  let action: React.ReactNode = null;

  if (review.length > 0) {
    tone = "bad";
    Icon = AlertCircle;
    title = `${plural(review.length, "saved bid")} couldn't be recorded.`;
    detail = `The server turned ${review.length === 1 ? "it" : "them"} down when ${review.length === 1 ? "it was" : "they were"} resent. Nothing else is affected.`;
    action = (
      <Button size="sm" variant="outline" className="bg-white" onClick={() => setReviewOpen((o) => !o)}>
        {reviewOpen ? "Hide" : "Review"}
      </Button>
    );
  } else if (outbox.needsSignIn && unsent > 0) {
    tone = "warn";
    Icon = LogIn;
    title = `Your sign-in has expired. ${plural(unsent, "bid")} saved on this device.`;
    detail = "Sign in again and they'll send on their own.";
    action = (
      <Button size="sm" variant="outline" className="bg-white" onClick={onSignIn}>
        Sign in again
      </Button>
    );
  } else if (!online) {
    tone = "warn";
    Icon = WifiOff;
    title = unsent > 0 ? `No internet connection. ${plural(unsent, "bid")} saved on this device.` : "No internet connection.";
    detail = unsent > 0
      ? "They'll send on their own when the connection is back. Keep entering bids, and keep this tab open."
      : "Winning bids you record now are saved on this device and sent once the connection is back.";
  } else if (outbox.sending) {
    tone = "info";
    Icon = Loader2;
    title = `Sending saved bids… ${Math.min(outbox.sending.sent + 1, outbox.sending.total)} of ${outbox.sending.total}`;
    detail = "Each one is sent with the key it was saved with, so none can be recorded twice.";
  } else if (unsent > 0) {
    tone = "warn";
    Icon = RefreshCw;
    title = `${plural(unsent, "bid")} saved on this device, waiting to send.`;
    detail = "The server couldn't be reached. Trying again every 30 seconds.";
  } else if (retry.retrying > 0) {
    tone = "warn";
    Icon = RefreshCw;
    title = `Google Sheets is slow to respond. Retrying (attempt ${retry.attempt} of ${retry.maxAttempts})…`;
    detail = "Keep going. Your change stays on screen while it sends.";
  } else if (showCaughtUp) {
    tone = "ok";
    Icon = CheckCircle2;
    title = "All saved bids sent.";
    detail = "They're in the Bid-Management sheet now.";
  } else if (showRecovered) {
    tone = "ok";
    Icon = CheckCircle2;
    title = "Google Sheets is responding again.";
  }

  return (
    // Always rendered, even when empty: screen readers only announce
    // changes to a live region that was already on the page.
    <div role="status" aria-live="polite" className={cn(tone && "mb-4 space-y-2")}>
      {tone && (
        <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", TONES[tone].box)}>
          <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", TONES[tone].icon, Icon === Loader2 && "animate-spin")} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{title}</p>
            {detail && <p className="text-muted-foreground">{detail}</p>}
          </div>
          {action && <div className="shrink-0 self-center">{action}</div>}
        </div>
      )}
      {tone === "bad" && reviewOpen && (
        <div className="rounded-lg border border-red-200 bg-background p-4 space-y-3 text-sm">
          <p className="font-semibold">Saved bids that need review</p>
          {review.map((entry) => (
            <div key={entry.body.idempotencyKey} className="flex flex-col sm:flex-row sm:items-center gap-3 border-t pt-3 first-of-type:border-0 first-of-type:pt-0">
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  #{entry.body.itemId} {entry.itemName} · {entry.bidderName} · ${entry.body.price.toFixed(2)}
                </p>
                <p className="text-muted-foreground">{entry.problem}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => retryOutboxEntry(entry.body.idempotencyKey)}>
                  Try again
                </Button>
                <Button size="sm" variant="outline" onClick={() => removeFromOutbox(entry.body.idempotencyKey)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Removing a bid only clears it from this list. If it should still be recorded, enter it again in Bid Entry once the problem is fixed.
          </p>
        </div>
      )}
    </div>
  );
}

/** The waiting count in the sidebar, so it shows from every screen. */
export function SavedBidsSidebarBadge({ expanded }: { expanded: boolean }) {
  const { entries } = useBidOutbox();
  const waiting = entries.filter((e) => e.status !== "needsReview").length;
  const review = entries.length - waiting;
  if (entries.length === 0) return null;
  const label = review > 0 ? `${plural(review, "bid")} to review` : `${plural(waiting, "bid")} waiting`;
  const colors = review > 0 ? "bg-red-50 text-orns-red border-red-200" : "bg-amber-50 text-amber-700 border-amber-200";
  return expanded ? (
    <div className={cn("w-full mb-2 flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium", colors)}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </div>
  ) : (
    <span className={cn("mb-2 w-2.5 h-2.5 rounded-full", review > 0 ? "bg-orns-red" : "bg-amber-500")} title={label} aria-label={label} />
  );
}
