import { useState } from "react";
import { useAuction } from "@/context/AuctionContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Tag } from "lucide-react";
import { toast } from "sonner";
import { FilterToolbar } from "@/components/FilterToolbar";
import { DataTableWrapper } from "@/components/DataTableWrapper";
import type { AuctionItem } from "@/types";

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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-primary" />
                Auction Catalog
              </CardTitle>
              <CardDescription>
                Full list of auction items. Item numbers should match the display cards.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <DataTableWrapper<AuctionItem>
            items={filteredItems}
            loading={loading}
            columnCount={4}
            skeletonRowCount={8}
            scrollAreaClassName="h-[650px]"
            tableClassName="table-fixed w-full"
            header={
              <TableRow>
                <TableHead className="w-[15%] whitespace-normal break-words">Item #</TableHead>
                <TableHead className="w-[35%] whitespace-normal break-words">Item Name</TableHead>
                <TableHead className="w-[25%] whitespace-normal break-words">Type</TableHead>
                <TableHead className="w-[25%] whitespace-normal break-words">Winning Bidder</TableHead>
              </TableRow>
            }
            renderRow={(item) => (
              <TableRow key={item.id}>
                <TableCell className="w-[15%] font-mono font-bold text-primary whitespace-normal break-words">{item.id}</TableCell>
                <TableCell className="w-[35%] font-medium whitespace-normal break-words">{item.name}</TableCell>
                <TableCell className="w-[25%] text-xs uppercase text-muted-foreground font-semibold whitespace-normal break-words">{item.category || "—"}</TableCell>
                <TableCell className="w-[25%] whitespace-normal break-words">
                  {winners[item.id] ? (
                    <span className="font-semibold text-emerald-600">{winners[item.id]}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm italic">—</span>
                  )}
                </TableCell>
              </TableRow>
            )}
            emptyMessage={searchTerm ? "No items match your search." : "No items loaded. Check your Spreadsheet ID in Settings."}
          />
        </CardContent>
      </Card>
    </div>
  );
}