import { AnimatePresence } from "motion/react";
import { Package } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { AuctionItemRow } from "@/components/AuctionItemRow";
import { AuctionItem } from "@/types";

interface AuctionItemsListProps {
  items: AuctionItem[];
  selectedRows: Record<number, boolean>;
  selectedItemsCount: number;
  onToggleRow: (rowIndex: number) => void;
  onToggleAll: () => void;
  onEditRequest: (item: AuctionItem) => void;
  isAuctionClosed: boolean;
  isExecutingRestore: boolean;
  restoreBundleId: string | null;
  onRestoreBundle: (bundleId: string) => void;
  onDeleteRequest: (item: AuctionItem) => void;
}

/**
 * Row-based replacement for the old <table>-based AuctionItemsTable.tsx
 * (see refactor-opportunities.md's "UI / Layout Tweaks" item), matching
 * ItemRow.tsx/ItemsList.tsx's pattern on the read-only Bid Management
 * Items tab. The old table's clickable-column-header sort moved to a
 * "Sort by" select in AuctionItemsFilterBar.tsx, since there's no table
 * header left to click - but the select-all checkbox still needs a home,
 * so it lives in this list's own small header bar instead (rendered
 * first, so it stays the first checkbox in the DOM - existing tests index
 * into `getAllByRole("checkbox")` expecting select-all at [0]).
 */
export function AuctionItemsList({
  items,
  selectedRows,
  selectedItemsCount,
  onToggleRow,
  onToggleAll,
  onEditRequest,
  isAuctionClosed,
  isExecutingRestore,
  restoreBundleId,
  onRestoreBundle,
  onDeleteRequest,
}: AuctionItemsListProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-5 py-2.5 border-b text-xs">
        <Checkbox
          checked={selectedItemsCount === items.length && items.length > 0}
          onCheckedChange={onToggleAll}
        />
        <span className="text-muted-foreground font-medium">
          {selectedItemsCount > 0 ? `${selectedItemsCount} of ${items.length} selected` : `Select all ${items.length} items`}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
          <Package className="w-7 h-7" />
          <span className="text-sm">No items found.</span>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <AuctionItemRow
              key={item.rowIndex}
              item={item}
              isSelected={!!selectedRows[item.rowIndex]}
              onToggleSelect={onToggleRow}
              onEditRequest={onEditRequest}
              isAuctionClosed={isAuctionClosed}
              isExecutingRestore={isExecutingRestore}
              restoreBundleId={restoreBundleId}
              onRestoreBundle={onRestoreBundle}
              onDeleteRequest={onDeleteRequest}
            />
          ))}
        </AnimatePresence>
      )}
    </div>
  );
}
