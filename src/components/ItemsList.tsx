import { Tag } from "lucide-react";
import { RowListShell } from "@/components/RowListShell";
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
 * CHANGELOG.md's "UI / Layout Tweaks" item), matching
 * AttendeesList.tsx's plain-div-list pattern exactly (including no
 * enter/exit animation - the old table this replaces never animated
 * either, unlike BiddersList.tsx which preserved a pre-existing one).
 */
export function ItemsList({ items, loading, hasActiveSearch, winners }: ItemsListProps) {
  return (
    <RowListShell
      items={items}
      loading={loading}
      skeletonRowCount={8}
      emptyIcon={<Tag className="w-7 h-7" />}
      emptyMessage={hasActiveSearch ? "No items match your search." : "No items loaded. Check your Spreadsheet ID in Settings."}
      renderRow={(item) => <ItemRow key={item.id} item={item} winnerName={winners[item.id]} />}
    />
  );
}
