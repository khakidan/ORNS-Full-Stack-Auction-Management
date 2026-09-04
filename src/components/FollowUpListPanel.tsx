import type { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface FollowUpListPanelProps {
  icon: ReactNode;
  title: string;
  count: number;
  countLabel?: string;
  countBadgeClassName: string;
  isEmpty: boolean;
  emptyMessage: string;
  note?: string;
  children: ReactNode;
}

/**
 * One scrollable list panel in the post-auction Follow-Up card: header
 * with icon/title/count badge, a fixed-height scroll area holding either
 * the real list (passed as children) or an empty message, and an
 * optional footnote. Consolidates what used to be three
 * near-identical hand-copied panels (Pending Checkouts, Follow-Up
 * Records, No Shows) in Dashboard.tsx.
 */
export function FollowUpListPanel({
  icon,
  title,
  count,
  countLabel = "Total",
  countBadgeClassName,
  isEmpty,
  emptyMessage,
  note,
  children,
}: FollowUpListPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-sm uppercase tracking-wider text-slate-500 flex items-center gap-2">
          {icon} {title}
        </h4>
        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", countBadgeClassName)}>
          {count} {countLabel}
        </span>
      </div>
      <ScrollArea className="h-75 rounded-md border bg-white p-4">
        <div className="space-y-3">
          {isEmpty ? (
            <div className="text-center py-12 text-muted-foreground italic">{emptyMessage}</div>
          ) : (
            children
          )}
        </div>
      </ScrollArea>
      {note && (
        <p className="text-xxs text-muted-foreground italic mt-2">{note}</p>
      )}
    </div>
  );
}
