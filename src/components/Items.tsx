import { useState } from "react";
import { useAuction } from "@/context/AuctionContext";
import { ListPageCard } from "@/components/ui/ListPageCard";
import { Tag } from "lucide-react";
import { FilterToolbar } from "@/components/FilterToolbar";
import { ItemsList } from "@/components/ItemsList";

export default function Items() {
  const { items, winners, loading } = useAuction();
  const [searchTerm, setSearchTerm] = useState("");

  // Sorted numerically by item number - found via a user-reported bug:
  // `items` arrives in whatever row order the spreadsheet currently has
  // (which can drift from numeric order after edits/bundles/deletions,
  // since resequencing only changes an item's ID value, not its row
  // position), and this table rendered that raw order with no sort of its
  // own. Matches the numeric-sort convention already used for the same
  // field elsewhere (e.g. itemDataService.ts's getValidSortedItems,
  // useDashboardState.ts) - `parseInt(id, 10) || 0` so a non-numeric id
  // sorts as 0 rather than producing NaN comparisons.
  const filteredItems = items
    .filter(item =>
      item.status === "Active" &&
      (item.id.toString().includes(searchTerm) ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()))
    )
    .sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));

  return (
    <div className="space-y-6">
      <FilterToolbar
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search items by box number or name..."
        trailing={
          <div className="text-sm font-medium text-muted-foreground bg-white px-3 py-1.5 rounded border border-slate-200 shadow-sm">
            Total Items: <span className="text-orns-red font-bold">{items.length}</span>
          </div>
        }
      />

      <ListPageCard
        icon={<Tag className="w-5 h-5 text-primary" />}
        title="Auction Catalog"
        description="Full list of auction items. Item numbers should match the display cards."
      >
        <ItemsList
          items={filteredItems}
          loading={loading}
          hasActiveSearch={searchTerm.length > 0}
          winners={winners}
        />
      </ListPageCard>
    </div>
  );
}