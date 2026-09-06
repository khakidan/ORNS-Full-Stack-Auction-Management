import { Tag } from "lucide-react";
import { ItemRow } from "@/components/ItemRow";
import { AuctionItem } from "@/types";

interface ItemsListProps {
  items: AuctionItem[];
  loading: boolean;
  /** Whether a search term is active - the empty-state message branches on this exactly like Items.tsx's original emptyMessage prop did. */
  hasActiveSearch: boolean;
  winners: Record<string, string>;
}

/**
 * Row-based replacement for the old <table>-based Auction Catalog (see
 * refactor-opportunities.md's "UI / Layout Tweaks" item), matching
 * AttendeesList.tsx's plain-div-list pattern exactly (including no
 * enter/exit animation - the old table this replaces never animated
 * either, unlike BiddersList.tsx which preserved a pre-existing one).
 */
export function ItemsList({ items, loading, hasActiveSearch, winners }: ItemsListProps) {
  if (loading) {
    return (
      <div className="flex flex-col">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 border-b last:border-0 animate-pulse bg-muted/40" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-14 text-muted-foreground">
        <Tag className="w-7 h-7" />
        <span className="text-sm">
          {hasActiveSearch ? "No items match your search." : "No items loaded. Check your Spreadsheet ID in Settings."}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <ItemRow key={item.id} item={item} winnerName={winners[item.id]} />
      ))}
    </div>
  );
}
