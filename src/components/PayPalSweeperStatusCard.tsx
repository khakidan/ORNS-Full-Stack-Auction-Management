import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { usePaypalSweeperStatus } from "@/hooks/usePaypalSweeperStatus";

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

  const { credentialConfigured, credentialUpdatedBy, credentialUpdatedAt, intervalMinutes, lastRunAt, lastResult, nextRunAt } = status;

  const lastResultSummary = !lastResult
    ? "No runs yet since the server last started."
    : "skipped" in lastResult
      ? `Skipped: ${lastResult.skipped}`
      : `${lastResult.pending} pending, ${lastResult.resolved} resolved, ${lastResult.escalated} escalated.`;

  const healthy = credentialConfigured && !!lastRunAt;

  return (
    <Card className={healthy ? "border-emerald-200 bg-emerald-50/10" : "border-amber-200 bg-amber-50/10"}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {healthy ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}
            PayPal Sweeper Status
          </CardTitle>
          <Badge variant={healthy ? "secondary" : "outline"} className={healthy ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}>
            {healthy ? "Running" : "Needs Attention"}
          </Badge>
        </div>
        <CardDescription>
          Background reconciliation for deferred credit-card/PayPal checkouts - runs automatically every {intervalMinutes} minute{intervalMinutes === 1 ? "" : "s"}.
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
          <span className="text-muted-foreground">Last sweep</span>
          <span className="text-right font-medium">
            {formatTimestamp(lastRunAt)}
            <span className="block text-xs text-muted-foreground font-normal">{lastResultSummary}</span>
          </span>
        </div>

        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground">Next expected run</span>
          <span className="text-right font-medium">{formatTimestamp(nextRunAt)}</span>
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
