import { useEffect, useState } from "react";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { useConfig } from "@/context/ConfigContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Badge } from "@/components/ui/badge";
import { Bug, CheckCircle2, ExternalLink, Eye, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { DataTableWrapper } from "@/components/DataTableWrapper";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { BugReportDetailDialog } from "@/components/BugReportDetailDialog";
import { BugReportListItem } from "@/types";

const TYPE_BADGE_CLASS: Record<string, string> = {
  "Bug": "bg-red-50 text-red-700 border-red-200",
  "UI Issue": "bg-amber-50 text-amber-700 border-amber-200",
  "Workflow Issue": "bg-blue-50 text-blue-700 border-blue-200",
};

export default function BugReportsAdmin() {
  const { config } = useConfig();
  const spreadsheetId = config.bugReportsSpreadsheetId;
  const isInvalidId = !spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE");

  const [reports, setReports] = useState<BugReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [viewingReport, setViewingReport] = useState<BugReportListItem | null>(null);

  const fetchReports = async () => {
    if (isInvalidId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bug-reports/list?spreadsheetId=${encodeURIComponent(spreadsheetId)}`, {
        credentials: "include"
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch bug reports");
      }
      const data = await res.json();
      setReports(data.reports || []);
    } catch (error: any) {
      console.error(error);
      toast.error(`Error loading bug reports: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spreadsheetId]);

  const handleResolve = async (report: BugReportListItem) => {
    setResolvingId(report.reportId);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bug-reports/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, reportId: report.reportId }),
        credentials: "include"
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to mark report resolved");
      }
      setReports(prev => prev.filter(r => r.reportId !== report.reportId));
      toast.success(`Marked "${report.title}" as resolved`);
    } catch (error: any) {
      console.error(error);
      toast.error(`Error resolving report: ${error.message}`);
    } finally {
      setResolvingId(null);
    }
  };

  if (isInvalidId) {
    return (
      <Card>
        <CardContent className="h-100 flex items-center justify-center">
          <StatusStatePlaceholder
            icon={<Bug />}
            title="No Bug Reports Spreadsheet Configured"
            description="Please configure the Bug Reports Spreadsheet ID in the Settings tab to view open reports."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            <Bug className="w-5 h-5 text-primary" />
            Open Bug Reports
          </CardTitle>
          <CardDescription>
            Reports submitted via the in-app bug tool (Ctrl/Cmd+Shift+B) that are still marked Open.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={fetchReports} disabled={loading} className="gap-2">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <DataTableWrapper<BugReportListItem>
          items={reports}
          loading={loading}
          columnCount={5}
          header={
            <TableRow>
              <TableHead className="w-25">Type</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Reported</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          }
          emptyMessage={
            <span className="flex flex-col items-center gap-2 text-slate-500">
              <CheckCircle2 className="w-8 h-8 text-slate-300" />
              No open bug reports.
            </span>
          }
          renderRow={(report) => (
            <TableRow key={report.reportId}>
              <TableCell>
                <Badge variant="outline" className={cn("font-normal", TYPE_BADGE_CLASS[report.type])}>
                  {report.type}
                </Badge>
              </TableCell>
              <TableCell className="font-medium">
                <span className="truncate max-w-75 block" title={report.description}>
                  {report.title}
                </span>
              </TableCell>
              <TableCell className="text-slate-500 text-sm">{report.route}</TableCell>
              <TableCell className="text-slate-500 text-sm">
                {report.timestamp ? format(new Date(report.timestamp), "MMM d, yyyy h:mm a") : ""}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => setViewingReport(report)}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    View
                  </Button>
                  {report.screenshotLink && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={() => window.open(report.screenshotLink, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Screenshot
                    </Button>
                  )}
                  <LoadingButton
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    loading={resolvingId === report.reportId}
                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                    onClick={() => handleResolve(report)}
                  >
                    Resolve
                  </LoadingButton>
                </div>
              </TableCell>
            </TableRow>
          )}
        />
      </CardContent>
      <BugReportDetailDialog
        report={viewingReport}
        onOpenChange={(open) => { if (!open) setViewingReport(null); }}
      />
    </Card>
  );
}
