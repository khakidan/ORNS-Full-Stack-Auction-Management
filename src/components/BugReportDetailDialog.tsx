import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatReportAsMarkdown } from "@/lib/bugReportContext";
import { BugReportListItem } from "@/types";

interface BugReportDetailDialogProps {
  report: BugReportListItem | null;
  onOpenChange: (open: boolean) => void;
}

export function BugReportDetailDialog({ report, onOpenChange }: BugReportDetailDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(formatReportAsMarkdown(report));
      setCopied(true);
      toast.success("Copied as Markdown - paste it into Claude Code to get help fixing it");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[BugReport] Copy to clipboard failed:", error);
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <Dialog open={!!report} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        {report && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {report.title}
              </DialogTitle>
              <DialogDescription className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{report.type}</Badge>
                <span>{report.timestamp ? format(new Date(report.timestamp), "MMM d, yyyy h:mm a") : ""}</span>
                <span>&middot;</span>
                <span>{report.route}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-sm">
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">Description</h4>
                <p className="whitespace-pre-wrap">{report.description}</p>
              </div>

              {report.screenshotLink && (
                <div>
                  <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">Screenshot</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => window.open(report.screenshotLink, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Screenshot
                  </Button>
                </div>
              )}

              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">App State</h4>
                <pre className="whitespace-pre-wrap bg-slate-50 rounded-md p-3 text-xs font-mono border">{report.appState}</pre>
              </div>

              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">Browser Info</h4>
                <pre className="whitespace-pre-wrap bg-slate-50 rounded-md p-3 text-xs font-mono border">{report.browserInfo}</pre>
              </div>

              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">Recent Console Activity</h4>
                <pre className="whitespace-pre-wrap bg-slate-50 rounded-md p-3 text-xs font-mono border max-h-48 overflow-y-auto">{report.consoleActivity}</pre>
              </div>
            </div>

            <DialogFooter showCloseButton>
              <Button onClick={handleCopy} className="gap-2">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied!" : "Copy as Markdown"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
