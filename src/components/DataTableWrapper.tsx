import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface DataTableWrapperProps<T> {
  items: T[];
  loading: boolean;
  /** Number of columns - used for the skeleton/empty rows' colSpan. */
  columnCount: number;
  /** Full <TableRow>...</TableRow> content for the table header. */
  header: ReactNode;
  /** Returns a full <TableRow key={...}>...</TableRow> for one item. */
  renderRow: (item: T, index: number) => ReactNode;
  /**
   * Wraps the generated row elements when `items` is non-empty - e.g.
   * `(rows) => <AnimatePresence mode="popLayout">{rows}</AnimatePresence>`
   * for enter/exit row animation. Defaults to rendering the rows as-is.
   */
  wrapItemRows?: (rows: ReactNode[]) => ReactNode;
  emptyMessage: ReactNode;
  skeletonRowCount?: number;
  /**
   * Pass a literal Tailwind height class (e.g. "h-[650px]") to wrap the
   * table in a vertically-scrolling ScrollArea. Omit for the more common
   * case of a horizontal-only overflow-x-auto container. Must be a literal
   * string in the consuming file so Tailwind's static scan picks it up -
   * building it dynamically won't generate the CSS.
   */
  scrollAreaClassName?: string;
  tableClassName?: string;
  className?: string;
}

/**
 * Shared scrollable data-table shell: consistent header styling, animated
 * skeleton rows while loading, and a stylized empty-state row - the parts
 * that were previously hand-duplicated across Items.tsx, Bidders.tsx, and
 * Receipts.tsx (see CHANGELOG.md). Column widths, header
 * content (including sort click handlers), and row rendering stay fully
 * caller-controlled via `header`/`renderRow`, since those are genuinely
 * different per screen.
 */
export function DataTableWrapper<T>({
  items,
  loading,
  columnCount,
  header,
  renderRow,
  wrapItemRows = (rows) => rows,
  emptyMessage,
  skeletonRowCount = 6,
  scrollAreaClassName,
  tableClassName,
  className,
}: DataTableWrapperProps<T>) {
  const body = loading ? (
    Array.from({ length: skeletonRowCount }).map((_, i) => (
      <TableRow key={`skeleton-${i}`}>
        <TableCell colSpan={columnCount} className="h-12 animate-pulse" />
      </TableRow>
    ))
  ) : items.length > 0 ? (
    wrapItemRows(items.map((item, i) => renderRow(item, i)))
  ) : (
    <TableRow>
      <TableCell colSpan={columnCount} className="h-32 text-center text-muted-foreground">
        {emptyMessage}
      </TableCell>
    </TableRow>
  );

  const table = (
    <Table className={tableClassName}>
      <TableHeader className="bg-slate-50 sticky top-0 z-10">{header}</TableHeader>
      <TableBody>{body}</TableBody>
    </Table>
  );

  if (scrollAreaClassName) {
    return <ScrollArea className={cn(scrollAreaClassName, className)}>{table}</ScrollArea>;
  }

  return <div className={cn("rounded-md border overflow-x-auto", className)}>{table}</div>;
}
