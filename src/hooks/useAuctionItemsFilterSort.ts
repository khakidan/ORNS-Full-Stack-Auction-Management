import { useMemo, useState } from "react";
import { parseDollar } from "@/lib/auctionItemPricing";
import { AuctionItem } from "@/types";

export interface BundlingSelection {
  [rowIndex: number]: boolean;
}

export interface AuctionItemSortConfig {
  key: keyof AuctionItem | null;
  direction: "asc" | "desc";
}

/** `selection` minus any row not in `visible` (the same object if nothing goes). */
function pruneToVisible(selection: BundlingSelection, visible: AuctionItem[]): BundlingSelection {
  const visibleRowIndexes = new Set(visible.map(item => item.rowIndex));
  let changed = false;
  const pruned: BundlingSelection = {};
  for (const key of Object.keys(selection)) {
    const rowIndex = Number(key);
    if (selection[rowIndex] && visibleRowIndexes.has(rowIndex)) {
      pruned[rowIndex] = true;
    } else if (selection[rowIndex]) {
      changed = true;
    }
  }
  return changed ? pruned : selection;
}

/**
 * Filtering, sorting, search, and row-selection state for the auction
 * items table. Split out of useAuctionItemsTableState.ts (was 437
 * lines) so that container stays focused on composing the split-out
 * pieces.
 */
/** `isLocked`: rows that can't be selected - a standard item, for someone who may not change one. */
export function useAuctionItemsFilterSort(items: AuctionItem[], isLocked: (item: AuctionItem) => boolean = () => false) {
  const [sortConfig, setSortConfig] = useState<AuctionItemSortConfig>({ key: "id", direction: "asc" });
  // Every row the user has ticked, visible or not - see selectedRows below.
  const [checkedRows, setCheckedRows] = useState<BundlingSelection>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedItemType, setSelectedItemType] = useState("all");

  const sortedItems = useMemo(() => {
    let sortableItems = [...items];

    // Filter items first
    sortableItems = sortableItems.filter(item => {
      if (item.status === "Inactive" || item.status === "Deleted") return false;

      const searchStr = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm ||
        item.name.toLowerCase().includes(searchStr) ||
        item.description.toLowerCase().includes(searchStr) ||
        item.category.toLowerCase().includes(searchStr) ||
        item.donor.toLowerCase().includes(searchStr) ||
        item.itemType.toLowerCase().includes(searchStr);

      const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
      const matchesType = selectedItemType === "all" || item.itemType === selectedItemType;

      return matchesSearch && matchesCategory && matchesType;
    });

    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key!]?.toString() || "";
        let bVal = b[sortConfig.key!]?.toString() || "";

        if (sortConfig.key === 'id') {
          return sortConfig.direction === 'asc'
            ? (parseInt(aVal) || 0) - (parseInt(bVal) || 0)
            : (parseInt(bVal) || 0) - (parseInt(aVal) || 0);
        }

        if (sortConfig.key === 'value' || sortConfig.key === 'openingBid' || sortConfig.key === 'minRaise') {
          const aNum = parseDollar(aVal);
          const bNum = parseDollar(bVal);
          return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
        }

        if (aVal.toString().toLowerCase() < bVal.toString().toLowerCase()) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal.toString().toLowerCase() > bVal.toString().toLowerCase()) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig, searchTerm, selectedCategory, selectedItemType]);

  // The selection is only the ticked rows still in view (search,
  // category, or type filter), so a bundle or bulk action can't silently
  // include an item that's no longer visible in the table. A ticked row
  // a filter hides comes back ticked when the filter is cleared. Derived
  // during render rather than pruned in an effect (ROADMAP.md R15).
  const selectedRows = useMemo(() => pruneToVisible(checkedRows, sortedItems), [checkedRows, sortedItems]);
  const selectedItemsCount = Object.values(selectedRows).filter(Boolean).length;

  const toggleRow = (rowIndex: number) => {
    setCheckedRows(prev => ({
      ...prev,
      [rowIndex]: !prev[rowIndex]
    }));
  };

  const selectableCount = sortedItems.filter(item => !isLocked(item)).length;

  const toggleAll = () => {
    if (selectedItemsCount === selectableCount && selectableCount > 0) {
      setCheckedRows({});
    } else {
      const all: BundlingSelection = {};
      sortedItems.forEach(item => {
        if (!isLocked(item)) all[item.rowIndex] = true;
      });
      setCheckedRows(all);
    }
  };

  const resetFilters = () => {
    setSearchTerm("");
    setSelectedCategory("all");
    setSelectedItemType("all");
  };

  return {
    sortConfig,
    setSortConfig,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    selectedItemType,
    setSelectedItemType,
    resetFilters,
    sortedItems,

    selectedRows,
    selectedItemsCount,
    toggleRow,
    toggleAll,
    selectableCount,
    clearSelection: () => setCheckedRows({}),
  };
}
