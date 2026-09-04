import { Bug } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BugReportType } from "@/types";
import { BugReportFormState } from "@/hooks/useBugReportState";

const TYPE_LABELS: Record<BugReportType, string> = {
  Bug: "Bug",
  "UI Issue": "UI Issue",
  "Workflow Issue": "Workflow Issue",
};

interface BugReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: BugReportFormState;
  onFormChange: (form: BugReportFormState) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function BugReportDialog({ open, onOpenChange, form, onFormChange, onSubmit, isSubmitting }: BugReportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bug className="w-5 h-5" />
            Report a Bug or Issue
          </DialogTitle>
          <DialogDescription>
            Captures the current page, app state, browser info, and recent console activity automatically - just describe what happened.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="bugReportTitle">Title</Label>
            <Input
              id="bugReportTitle"
              placeholder="Short summary"
              value={form.title}
              onChange={(e) => onFormChange({ ...form, title: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bugReportDescription">Description</Label>
            <Textarea
              id="bugReportDescription"
              placeholder="What were you doing, what happened, what did you expect?"
              value={form.description}
              onChange={(e) => onFormChange({ ...form, description: e.target.value })}
              className="min-h-[120px]"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bugReportType">Type</Label>
            <Select value={form.type} onValueChange={(v) => onFormChange({ ...form, type: v as BugReportType })}>
              <SelectTrigger id="bugReportType" className="w-full">
                <SelectValue>{(value: BugReportType) => TYPE_LABELS[value] ?? value}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Bug">Bug</SelectItem>
                <SelectItem value="UI Issue">UI Issue</SelectItem>
                <SelectItem value="Workflow Issue">Workflow Issue</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="bugReportIncludeScreenshot"
              checked={form.includeScreenshot}
              onCheckedChange={(checked) => onFormChange({ ...form, includeScreenshot: checked === true })}
            />
            <Label htmlFor="bugReportIncludeScreenshot" className="font-normal">Include a screenshot</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <LoadingButton onClick={onSubmit} loading={isSubmitting}>Save Report</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
