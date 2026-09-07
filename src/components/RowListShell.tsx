import { ReactNode } from "react";
import { AnimatePresence } from "motion/react";

interface RowListShellProps<T> {
  items: T[];
  renderRow: (item: T) => ReactNode;
  emptyIcon: ReactNode;
  emptyMessage: ReactNode;
  loading?: boolean;
  skeletonRowCount?: number;
  /** Wraps rows in AnimatePresence for exit animations (row deletion, etc.) - only some lists need this. */
  animated?: boolean;
}

/**
 * Shared loading-skeleton/empty-state/row-list shell for this app's
 * flexible-row lists (the div-row replacement for the old <table>-based
 * lists - see refactor-opportunities.md's "UI / Layout Tweaks" history).
 * Consolidates markup that had drifted back into duplication across
 * ItemsList.tsx/BiddersList.tsx/AttendeesList.tsx/AuctionItemsList.tsx -
 * the same class of duplication DataTableWrapper.tsx already solved for
 * the earlier <table>-based lists, just regrown in the newer row shape.
 */
export function RowListShell<T>({
  items,
  renderRow,
  emptyIcon,
  emptyMessage,
  loading = false,
  skeletonRowCount = 6,
  animated = false,
}: RowListShellProps<T>) {
  if (loading) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: skeletonRowCount }).map((_, i) => (
          <div key={i} className="h-20 border-b last:border-0 animate-pulse bg-muted/40" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
        {emptyIcon}
        <span className="text-sm">{emptyMessage}</span>
      </div>
    );
  }

  const rows = items.map(renderRow);

  return (
    <div className="flex flex-col">
      {animated ? <AnimatePresence mode="popLayout">{rows}</AnimatePresence> : rows}
    </div>
  );
}
