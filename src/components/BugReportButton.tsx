import { Bug } from "lucide-react";
import { useBugReportState } from "@/hooks/useBugReportState";
import { BugReportDialog } from "./BugReportDialog";

/**
 * Small, low-contrast floating trigger for the bug-report dialog, always
 * available regardless of which workflow tab is active. Pinned
 * bottom-right, stacked above App.tsx's BackToTop button (also
 * bottom-right, but only visible once scrolled) so the two never
 * overlap. Originally placed bottom-left to avoid BackToTop - that
 * reasoning missed the app's persistent left sidebar (`fixed md:sticky
 * ... z-50`, spanning the full height including that exact corner),
 * which covered the button entirely. Right side is the real free space
 * in this layout.
 */
export function BugReportButton() {
  const { open, setOpen, form, setForm, isSubmitting, handleSubmit } = useBugReportState();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Report a bug or issue (Ctrl/Cmd+Shift+B)"
        aria-label="Report a bug or issue"
        className="fixed bottom-20 right-6 z-40 flex items-center justify-center w-9 h-9 rounded-full bg-slate-200/70 text-slate-500 hover:bg-slate-300 hover:text-slate-700 shadow-sm transition-colors"
      >
        <Bug className="w-4 h-4" />
      </button>

      <BugReportDialog
        open={open}
        onOpenChange={setOpen}
        form={form}
        onFormChange={setForm}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </>
  );
}
