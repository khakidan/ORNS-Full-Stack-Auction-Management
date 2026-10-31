import { ValueCalculationTier } from "@/lib/auctionItemPricing";
import { AuctionItem } from "@/types";
import { useAuctionItemsFilterSort } from "./useAuctionItemsFilterSort";
import { useAuctionItemUpdate } from "./useAuctionItemUpdate";
import { useAuctionItemsBulkEdit } from "./useAuctionItemsBulkEdit";
import { useAddAuctionItem } from "./useAddAuctionItem";
import { useDeleteAuctionItem } from "./useDeleteAuctionItem";

/**
 * Owns all list-level state and mutation handlers for the auction items
 * table: filtering/sorting, row selection, item edits, bulk edits,
 * add-item, and delete-item. Kept separate from AuctionItemsTab so that
 * component stays focused on composing/rendering the split-out pieces.
 *
 * This hook itself is just composition - the real logic lives in five
 * split-out pieces (useAuctionItemsFilterSort.ts, useAuctionItemUpdate.ts,
 * useAuctionItemsBulkEdit.ts, useAddAuctionItem.ts,
 * useDeleteAuctionItem.ts), the same container-hook-split pattern
 * already applied to every other oversized file in this app (see
 * AuctionContext.tsx). useAuctionItemsBulkEdit needs to read/clear the
 * row selection, so it's wired to useAuctionItemsFilterSort's
 * `selectedRows`/`clearSelection` - the same one-hook's-state-passed-
 * into-another pattern AuctionContext.tsx uses for its own child hooks.
 */
export function useAuctionItemsTableState(
  items: AuctionItem[],
  setItems: React.Dispatch<React.SetStateAction<AuctionItem[]>>,
  spreadsheetId: string,
  valueCalculations: ValueCalculationTier[],
  fetchData: () => Promise<void> | void,
  isLocked?: (item: AuctionItem) => boolean
) {
  const filterSort = useAuctionItemsFilterSort(items, isLocked);
  const { saveItemChanges } = useAuctionItemUpdate(items, setItems, spreadsheetId, valueCalculations, fetchData);
  const bulkEdit = useAuctionItemsBulkEdit(items, setItems, spreadsheetId, filterSort.selectedRows, filterSort.clearSelection, fetchData);
  const addItem = useAddAuctionItem(items, setItems, spreadsheetId, fetchData);
  const deleteItem = useDeleteAuctionItem(items, setItems, spreadsheetId, fetchData);

  return {
    // Filter/sort/search
    sortConfig: filterSort.sortConfig,
    setSortConfig: filterSort.setSortConfig,
    searchTerm: filterSort.searchTerm,
    setSearchTerm: filterSort.setSearchTerm,
    selectedCategory: filterSort.selectedCategory,
    setSelectedCategory: filterSort.setSelectedCategory,
    selectedItemType: filterSort.selectedItemType,
    setSelectedItemType: filterSort.setSelectedItemType,
    resetFilters: filterSort.resetFilters,
    sortedItems: filterSort.sortedItems,

    // Row selection
    selectedRows: filterSort.selectedRows,
    selectedItemsCount: filterSort.selectedItemsCount,
    toggleRow: filterSort.toggleRow,
    toggleAll: filterSort.toggleAll,
    selectableCount: filterSort.selectableCount,
    clearSelection: filterSort.clearSelection,

    // Edit dialog save
    saveItemChanges,

    // Bulk edit
    isBulkEditing: bulkEdit.isBulkEditing,
    setIsBulkEditing: bulkEdit.setIsBulkEditing,
    bulkField: bulkEdit.bulkField,
    bulkValue: bulkEdit.bulkValue,
    isExecutingBulk: bulkEdit.isExecutingBulk,
    startBulkEdit: bulkEdit.startBulkEdit,
    executeBulkUpdate: bulkEdit.executeBulkUpdate,

    // Add item
    isAddingItem: addItem.isAddingItem,
    setIsAddingItem: addItem.setIsAddingItem,
    openAddItemDialog: addItem.openAddItemDialog,
    newItem: addItem.newItem,
    setNewItem: addItem.setNewItem,
    isSubmittingItem: addItem.isSubmittingItem,
    handleAddItem: addItem.handleAddItem,

    // Delete item
    itemToDelete: deleteItem.itemToDelete,
    setItemToDelete: deleteItem.setItemToDelete,
    isDeleting: deleteItem.isDeleting,
    handleDeleteItem: deleteItem.handleDeleteItem,
  };
}
