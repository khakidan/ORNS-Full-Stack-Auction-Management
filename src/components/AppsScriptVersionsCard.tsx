import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { CheckCircle2, AlertTriangle, RefreshCw, FileCode2 } from "lucide-react";
import { AppsScriptVersionStatus, getAppsScriptVersions } from "@/services/google-api";

const BADGE = {
  ok: { className: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "Up to date" },
  outdated: { className: "bg-amber-100 text-amber-700 border-amber-200", label: "Out of date" },
  error: { className: "bg-red-100 text-red-700 border-red-200", label: "Couldn't check" },
};

/**
 * Settings card: asks each live Apps Script which version of its code it
 * is running (its Version.gs fingerprint) and compares that with the
 * version this build of the app expects. Checked on a click, not on page
 * load - each check runs all three scripts once.
 */
export default function AppsScriptVersionsCard() {
  const [scripts, setScripts] = useState<AppsScriptVersionStatus[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setScripts(await getAppsScriptVersions());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const allOk = scripts !== null && scripts.every((s) => s.status === "ok");

  return (
    <Card className={scripts === null ? "" : allOk ? "border-emerald-200 bg-emerald-50/10" : "border-amber-200 bg-amber-50/10"}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          {scripts === null ? <FileCode2 className="w-5 h-5 text-muted-foreground" /> : allOk ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <AlertTriangle className="w-5 h-5 text-amber-600" />}
          Apps Script Versions
        </CardTitle>
        <CardDescription>
          Checks that the three live Google Apps Scripts run the code this version of the app expects. "Out of date" means a script
          wasn't redeployed after a change (run <code>npm run gas:deploy</code>) or was changed outside the repo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error && <p className="text-red-700">{error}</p>}
        {scripts?.map((s) => (
          <div key={s.label} className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="text-right">
              <Badge variant="outline" className={BADGE[s.status].className}>{BADGE[s.status].label}</Badge>
              <span className="block text-xs text-muted-foreground mt-1">
                {s.status === "error" ? s.error : s.status === "outdated" ? `Live ${s.live}, expected ${s.expected}` : s.live}
              </span>
            </span>
          </div>
        ))}
        <LoadingButton
          variant="outline"
          size="sm"
          className="w-full"
          loading={checking}
          loadingText="Checking..."
          icon={<RefreshCw className="w-4 h-4 mr-2" />}
          onClick={check}
        >
          Check Script Versions
        </LoadingButton>
      </CardContent>
    </Card>
  );
}
