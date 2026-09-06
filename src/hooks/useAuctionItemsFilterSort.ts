import { useEffect, useMemo, useState } from "react";
import { parseDollar } from "@/lib/auctionItemPricing";
import { AuctionItem } from "@/types";

export interface BundlingSelection {
  [rowIndex: number]: boolean;
}

export interface AuctionItemSortConfig {
  key: keyof AuctionItem | null;
  direction: "asc" | "desc";
}

/**
 * Filtering, sorting, search, and row-selection state for the auction
 * items table. Split out of useAuctionItemsTableState.ts (was 437
 * lines) so that container stays focused on composing the split-out
 * pieces.
 */
export function useAuctionItemsFilterSort(items: AuctionItem[]) {
  const [sortConfig, setSortConfig] = useState<AuctionItemSortConfig>({ key: "id", direction: "asc" });
  const [selectedRows, setSelectedRows] = useState<BundlingSelection>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedItemType, setSelectedItemType] = useState("all");

  const selectedItemsCount = Object.values(selectedRows).filter(Boolean).length;

  const toggleRow = (rowIndex: number) => {
    setSelectedRows(prev => ({
      ...prev,
      [rowIndex]: !prev[rowIndex]
    }));
  };

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

  // Prunes selectedRows whenever the filtered/sorted view narrows (search,
  // category, or type filter changes), so a bundle action can't silently
  // include an item that's no longer visible in the table. Widening the
  // view back out (including via resetFilters) never removes a selected
  // item's rowIndex from sortedItems, so nothing gets pruned in that
  // direction - selections only survive as long as the item stays visible.
  useEffect(() => {
    const visibleRowIndexes = new Set(sortedItems.map(item => item.rowIndex));
    setSelectedRows(prev => {
      let changed = false;
      const pruned: BundlingSelection = {};
      for (const key of Object.keys(prev)) {
        const rowIndex = Number(key);
        if (prev[rowIndex] && visibleRowIndexes.has(rowIndex)) {
          pruned[rowIndex] = true;
        } else if (prev[rowIndex]) {
          changed = true;
        }
      }
      return changed ? pruned : prev;
    });
  }, [sortedItems]);

  const toggleAll = () => {
    if (selectedItemsCount === sortedItems.length && sortedItems.length > 0) {
      setSelectedRows({});
    } else {
      const all: BundlingSelection = {};
      sortedItems.forEach(item => {
        all[item.rowIndex] = true;
      });
      setSelectedRows(all);
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
    clearSelection: () => setSelectedRows({}),
  };
}
