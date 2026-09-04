import { AnimatePresence } from "motion/react";
import { ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { AuctionItemRow } from "@/components/AuctionItemRow";
import { AuctionItem } from "@/types";

const COLUMN_COUNT = 8;

interface SortConfig {
  key: keyof AuctionItem | null;
  direction: "asc" | "desc";
}

interface AuctionItemsTableProps {
  items: AuctionItem[];
  sortConfig: SortConfig;
  onRequestSort: (key: keyof AuctionItem) => void;
  selectedRows: Record<number, boolean>;
  onToggleRow: (rowIndex: number) => void;
  onToggleAll: () => void;
  onUpdate: (rowIndex: number, field: keyof AuctionItem, colLetter: string, value: string) => void;
  isAuctionClosed: boolean;
  categories: string[];
  isExecutingRestore: boolean;
  restoreBundleId: string | null;
  onRestoreBundle: (bundleId: string) => void;
  onDeleteRequest: (item: AuctionItem) => void;
}

function SortIndicator({ sortConfig, columnKey }: { sortConfig: SortConfig; columnKey: keyof AuctionItem }) {
  if (sortConfig.key !== columnKey) {
    return <ArrowUpDown className="ml-2 w-3 h-3 opacity-30 inline" />;
  }
  return sortConfig.direction === "asc" ? (
    <ArrowUp className="ml-2 w-3 h-3 inline text-primary" />
  ) : (
    <ArrowDown className="ml-2 w-3 h-3 inline text-primary" />
  );
}

export function AuctionItemsTable({
  items,
  sortConfig,
  onRequestSort,
  selectedRows,
  onToggleRow,
  onToggleAll,
  onUpdate,
  isAuctionClosed,
  categories,
  isExecutingRestore,
  restoreBundleId,
  onRestoreBundle,
  onDeleteRequest,
}: AuctionItemsTableProps) {
  const selectedItemsCount = Object.values(selectedRows).filter(Boolean).length;

  return (
    <div className="rounded-md border overflow-x-auto pb-4">
      <Table className="w-full table-fixed">
        <TableHeader>
          <TableRow className="bg-slate-50 text-xs">
            <TableHead className="w-10 px-2">
              <Checkbox checked={selectedItemsCount === items.length && items.length > 0} onCheckedChange={onToggleAll} />
            </TableHead>
            <TableHead className="w-[7%] cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => onRequestSort("id")}>
              ID <SortIndicator sortConfig={sortConfig} columnKey="id" />
            </TableHead>
            <TableHead className="w-[30%] cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => onRequestSort("name")}>
              Name & Description <SortIndicator sortConfig={sortConfig} columnKey="name" />
            </TableHead>
            <TableHead className="w-[15%] cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => onRequestSort("category")}>
              Category <SortIndicator sortConfig={sortConfig} columnKey="category" />
            </TableHead>
            <TableHead className="w-[18%] cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => onRequestSort("value")}>
              Value / Bids <SortIndicator sortConfig={sortConfig} columnKey="value" />
            </TableHead>
            <TableHead className="w-[15%] cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => onRequestSort("donor")}>
              Donor <SortIndicator sortConfig={sortConfig} columnKey="donor" />
            </TableHead>
            <TableHead className="w-[15%] cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => onRequestSort("itemType")}>
              Type <SortIndicator sortConfig={sortConfig} columnKey="itemType" />
            </TableHead>
            <TableHead className="w-15 text-center">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="text-center py-8 text-muted-foreground">
                No items found.
              </TableCell>
            </TableRow>
          ) : (
            <AnimatePresence mode="popLayout">
              {items.map((item) => (
                <AuctionItemRow
                  key={item.rowIndex}
                  item={item}
                  isSelected={!!selectedRows[item.rowIndex]}
                  onToggleSelect={onToggleRow}
                  onUpdate={onUpdate}
                  isAuctionClosed={isAuctionClosed}
                  categories={categories}
                  isExecutingRestore={isExecutingRestore}
                  restoreBundleId={restoreBundleId}
                  onRestoreBundle={onRestoreBundle}
                  onDeleteRequest={onDeleteRequest}
                />
              ))}
            </AnimatePresence>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
