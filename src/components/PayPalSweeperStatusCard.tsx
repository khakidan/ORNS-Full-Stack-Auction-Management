import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2, PauseCircle } from "lucide-react";
import { usePaypalSweeperStatus } from "@/hooks/usePaypalSweeperStatus";
import { cn } from "@/lib/utils";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

export default function PayPalSweeperStatusCard() {
  const { status, loading, running, runNow } = usePaypalSweeperStatus();

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            PayPal Sweeper Status
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
            PayPal Sweeper Status
          </CardTitle>
          <CardDescription>Couldn't reach the server to check status - try reloading the page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { credentialConfigured, credentialUpdatedBy, credentialUpdatedAt, intervalMinutes, scheduleActive, lastScheduledRunAt, lastRunAt, lastResult } = status;

  const lastResultSummary = !lastResult
    ? "No runs recorded yet."
    : "skipped" in lastResult
      ? `Skipped: ${lastResult.skipped}`
      : `${lastResult.pending} pending, ${lastResult.resolved} resolved, ${lastResult.escalated} escalated.`;

  // Three states: no credential (needs attention), scheduled runs
  // happening (running), or credential fine but the Cloud Scheduler job
  // paused - normal outside auction season.
  const state = !credentialConfigured ? "attention" : scheduleActive ? "running" : "paused";
  const styles = {
    attention: { card: "border-amber-200 bg-amber-50/10", badge: "bg-amber-100 text-amber-700 border-amber-200", label: "Needs Attention", icon: <AlertTriangle className="w-5 h-5 text-amber-600" /> },
    running: { card: "border-emerald-200 bg-emerald-50/10", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "Running", icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" /> },
    paused: { card: "", badge: "bg-slate-100 text-slate-700 border-slate-200", label: "Paused", icon: <PauseCircle className="w-5 h-5 text-slate-500" /> },
  }[state];

  return (
    <Card className={styles.card}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {styles.icon}
            PayPal Sweeper Status
          </CardTitle>
          <Badge variant="outline" className={styles.badge}>
            {styles.label}
          </Badge>
        </div>
        <CardDescription>
          Background reconciliation for deferred credit-card/PayPal checkouts - a Cloud Scheduler job runs it every {intervalMinutes} minute{intervalMinutes === 1 ? "" : "s"}. Resume that job before checkout opens and pause it after the auction.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Background sync credential</span>
          {credentialConfigured ? (
            <span className="text-right text-emerald-700 font-medium">
              Signed in{credentialUpdatedBy ? ` by ${credentialUpdatedBy}` : ""}
              {credentialUpdatedAt && <span className="block text-xs text-muted-foreground font-normal">{formatTimestamp(credentialUpdatedAt)}</span>}
            </span>
          ) : (
            <span className="text-right text-amber-700 font-medium">Not configured yet - sign in once to enable</span>
          )}
        </div>

        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Automatic schedule</span>
          <span className={cn("text-right font-medium", scheduleActive ? "text-emerald-700" : "text-slate-600")}>
            {scheduleActive ? "Active" : "Paused or not set up"}
            <span className="block text-xs text-muted-foreground font-normal">Last scheduled run: {formatTimestamp(lastScheduledRunAt)}</span>
          </span>
        </div>

        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Last sweep</span>
          <span className="text-right font-medium">
            {formatTimestamp(lastRunAt)}
            <span className="block text-xs text-muted-foreground font-normal">{lastResultSummary}</span>
          </span>
        </div>

        <LoadingButton
          variant="outline"
          size="sm"
          className="w-full"
          loading={running}
          loadingText="Running..."
          icon={<RefreshCw className="w-4 h-4 mr-2" />}
          onClick={runNow}
        >
          Run Sweep Now
        </LoadingButton>
      </CardContent>
    </Card>
  );
}
