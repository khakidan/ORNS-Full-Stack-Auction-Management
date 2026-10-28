import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2, PauseCircle } from "lucide-react";
import { TicketPurchaseStatusState } from "@/hooks/useTicketPurchaseStatus";
import { PENDING_DAYS, pendingTooLong, ticketStatusProblems } from "@/lib/ticketPurchaseStatus";
import { Attendee } from "@/types";
import { cn } from "@/lib/utils";

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

const WEBHOOK_OUTCOMES: Record<string, string> = {
  added: "added to the sheet",
  exists: "already in the sheet",
  "would-add": "not in the sheet yet",
  "needs-review": "needs review",
  error: "failed",
  "no-google-sign-in": "failed - no stored Google sign-in",
};

interface TicketPurchaseStatusCardProps {
  attendees: Attendee[];
  /** From useTicketPurchaseStatus - the page holds it, so the tab's attention dot and this card share one status. */
  purchases: TicketPurchaseStatusState;
}

/**
 * Website ticket purchases (ROADMAP W6): when the last webhook arrived,
 * when the poll last succeeded, the purchases the poll had to add (each a
 * missed webhook), the review list, and tickets still Pending after a
 * week - so a failure shows up days before the auction, not at check-in.
 */
export default function TicketPurchaseStatusCard({ attendees, purchases }: TicketPurchaseStatusCardProps) {
  const { status, loading, checking, checkNow } = purchases;

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            Website Ticket Check
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card className="border-amber-200 bg-amber-50/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            Website Ticket Check
          </CardTitle>
          <CardDescription>Couldn't reach the server to check status - try reloading the page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const now = new Date();
  const problems = ticketStatusProblems(status, now);
  const pending = pendingTooLong(attendees, status.submittedAt, now);
  const { lastWebhook, poll, missed, review } = status;

  const state = !status.configured ? "off" : problems.length > 0 ? "attention" : "working";
  const styles = {
    attention: { card: "border-amber-200 bg-amber-50/10", badge: "bg-amber-100 text-amber-700 border-amber-200", label: "Needs Attention", icon: <AlertTriangle className="w-5 h-5 text-amber-600" /> },
    working: { card: "", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "Working", icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" /> },
    off: { card: "", badge: "bg-slate-100 text-slate-700 border-slate-200", label: "Not Set Up", icon: <PauseCircle className="w-5 h-5 text-slate-500" /> },
  }[state];

  return (
    <Card className={styles.card}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {styles.icon}
            Website Ticket Check
          </CardTitle>
          <Badge variant="outline" className={styles.badge}>
            {styles.label}
          </Badge>
        </div>
        <CardDescription>
          {!status.configured
            ? "The server can't read the website's ticket form yet, so missed purchases aren't caught."
            : status.mode === "write"
              ? "Each purchase on the website is sent here; a check 4 times a day catches any that were missed."
              : "Shadow mode: the form's Sheets feed adds the rows. The website's purchases are checked against the sheet, and nothing is written."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {problems.length > 0 && (
          <ul className="space-y-1 text-amber-700 font-medium">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        )}

        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Last purchase sent by the website</span>
          <span className="text-right font-medium">
            {formatTimestamp(lastWebhook?.at)}
            {lastWebhook && (
              <span className={cn("block text-xs font-normal", lastWebhook.error ? "text-amber-700" : "text-muted-foreground")}>
                Entry {lastWebhook.entryId}: {WEBHOOK_OUTCOMES[lastWebhook.outcome] ?? lastWebhook.outcome}
              </span>
            )}
          </span>
        </div>

        {status.configured && (
          <div className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">Last successful check</span>
            <span className="text-right font-medium">
              {formatTimestamp(poll?.lastSuccessAt)}
              {poll && poll.lastRunErrors.length > 0 && (
                <span className="block text-xs text-amber-700 font-normal">Last check ({formatTimestamp(poll.lastRunAt)}) stopped: {poll.lastRunErrors[0]}</span>
              )}
            </span>
          </div>
        )}

        {missed.length > 0 && (
          <div>
            <span className="text-muted-foreground">
              {status.mode === "write" ? "Added by the check (the website's message was missed)" : "Missing from the sheet when checked"}: {missed.length}
            </span>
            <span className="block text-xs text-muted-foreground">Entries {missed.map((m) => m.entryId).join(", ")}</span>
          </div>
        )}

        {review.length > 0 && (
          <div>
            <span className="text-amber-700 font-medium">Needs review: {review.length}</span>
            <ul className="mt-1 space-y-1 text-xs">
              {review.map((item) => (
                <li key={item.entryId}>
                  <span className="font-medium">{item.name || "No name"} (entry {item.entryId})</span>: {item.problems.join("; ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {pending.length > 0 && (
          <div>
            <span className="text-muted-foreground">Still Pending after {PENDING_DAYS} days: {pending.length}</span>
            <ul className="mt-1 space-y-1 text-xs">
              {pending.map(({ attendee, submitted }) => (
                <li key={attendee.id}>
                  {attendee.firstName} {attendee.lastName} - {attendee.paymentMethod || "unknown method"}, bought {submitted.toLocaleDateString()}
                </li>
              ))}
            </ul>
          </div>
        )}

        {status.configured && (
          <LoadingButton
            variant="outline"
            size="sm"
            className="w-full"
            loading={checking}
            loadingText="Checking..."
            icon={<RefreshCw className="w-4 h-4 mr-2" />}
            onClick={checkNow}
          >
            Check Now
          </LoadingButton>
        )}
      </CardContent>
    </Card>
  );
}
