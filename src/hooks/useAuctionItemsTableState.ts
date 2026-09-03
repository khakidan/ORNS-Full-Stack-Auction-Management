import { useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, updateSheetData, getBaseUrl, deleteAuctionItem } from "@/services/google-api";
import { parseDollar, calculateAutoBids, ValueCalculationTier } from "@/lib/auctionItemPricing";
import { AuctionItem } from "@/types";

interface BundlingSelection {
  [rowIndex: number]: boolean;
}

/**
 * Owns all list-level state and mutation handlers for the auction items
 * table: filtering/sorting, row selection, single-cell edits, bulk edits,
 * add-item, and delete-item. Kept separate from AuctionItemsTab so that
 * component stays focused on composing/rendering the split-out pieces.
 */
export function useAuctionItemsTableState(
  items: AuctionItem[],
  setItems: React.Dispatch<React.SetStateAction<AuctionItem[]>>,
  spreadsheetId: string,
  valueCalculations: ValueCalculationTier[],
  fetchData: () => Promise<void> | void
) {
  const [sortConfig, setSortConfig] = useState<{ key: keyof AuctionItem | null; direction: "asc" | "desc" }>({ key: "id", direction: "asc" });
  const [selectedRows, setSelectedRows] = useState<BundlingSelection>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedItemType, setSelectedItemType] = useState("all");

  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkField, setBulkField] = useState<"category" | "itemType" | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [isExecutingBulk, setIsExecutingBulk] = useState(false);

  const [isAddingItem, setIsAddingItem] = useState(false);
  const [addItemIdempotencyKey, setAddItemIdempotencyKey] = useState("");
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);
  const [newItem, setNewItem] = useState<Partial<AuctionItem>>({
    category: "",
    name: "",
    description: "",
    value: "",
    openingBid: "",
    minRaise: "",
    donor: "",
    itemType: ""
  });

  const [itemToDelete, setItemToDelete] = useState<AuctionItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const requestSort = (key: keyof AuctionItem) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') { direction = 'desc'; }
    setSortConfig({ key, direction });
  };

  const resetFilters = () => {
    setSearchTerm("");
    setSelectedCategory("all");
    setSelectedItemType("all");
  };

  const startBulkEdit = (field: "category" | "itemType", value: string) => {
    setBulkField(field);
    setBulkValue(value);
    setIsBulkEditing(true);
  };

  const executeBulkUpdate = async () => {
    if (!bulkField || !bulkValue || !spreadsheetId) return;

    setIsExecutingBulk(true);
    const selectedIndices = Object.keys(selectedRows).filter(k => selectedRows[parseInt(k)]).map(k => parseInt(k));
    const previousItems = [...items];

    // Optimistic Update
    setItems(prev => prev.map(item =>
      selectedIndices.includes(item.rowIndex) ? { ...item, [bulkField]: bulkValue } : item
    ));

    if (bulkField === 'category') {
      try {
        const response = await fetchWithRetry(`${getBaseUrl()}/api/auction/bulk-update-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spreadsheetId,
            rowIndices: selectedIndices,
            field: bulkField,
            value: bulkValue
          })
        });
        const resData = await response.json();
        if (resData.error) throw new Error(resData.error);
        toast.success("Bulk categories updated and re-sequenced successfully!");
        setSelectedRows({});
        setIsBulkEditing(false);
        setBulkField(null);
        setBulkValue("");
        fetchData();
      } catch (e: any) {
        console.error("Bulk category update failed:", e);
        setItems(previousItems);
        toast.error("Failed to bulk update categories: " + e.message);
      } finally {
        setIsExecutingBulk(false);
      }
      return;
    }

    // Only 'itemType' can reach here - the 'category' branch above already returned.
    const updatePromises = selectedIndices.map(idx =>
      updateSheetData(spreadsheetId, `Auction-Items!I${idx}`, [[bulkValue]])
    );

    // Background sync
    Promise.all(updatePromises)
      .then(() => {
        toast.success(`Updated ${bulkField} for ${selectedIndices.length} items`);
        setSelectedRows({});
        setIsBulkEditing(false);
        setBulkField(null);
        setBulkValue("");
      })
      .catch(() => {
        // Rollback
        setItems(previousItems);
        toast.error("Failed to sync updates—retrying... local state reverted.");
      })
      .finally(() => {
        setIsExecutingBulk(false);
      });
  };

  const handleUpdate = async (rowIndex: number, field: keyof AuctionItem, colLetter: string, value: string) => {
    if (!spreadsheetId) return;

    const targetItem = items.find(i => i.rowIndex === rowIndex);
    if (!targetItem) return;

    const previousItems = [...items];

    let finalValueToSave = value;
    if (field === 'value' && value) {
      const parsedNum = parseDollar(value);
      if (parsedNum > 0) {
        finalValueToSave = `$${parsedNum.toFixed(2)}`;
      }
    }

    // Optimistic update
    setItems((prev) =>
      prev.map((item) =>
        item.rowIndex === rowIndex ? { ...item, [field]: finalValueToSave } : item
      )
    );

    let updateOpening = false;
    let updateRaise = false;
    let opening = "";
    let raise = "";

    if (field === 'value') {
      const calculated = calculateAutoBids(finalValueToSave, valueCalculations);
      opening = calculated.opening;
      raise = calculated.raise;

      const currentOpening = targetItem.openingBid;
      const currentRaise = targetItem.minRaise;

      const isOpeningEmpty = !currentOpening ||
                             currentOpening.trim() === '' ||
                             currentOpening.trim() === '$' ||
                             currentOpening.trim() === '$,' ||
                             currentOpening.trim() === '$, ';

      const isRaiseEmpty = !currentRaise ||
                           currentRaise.trim() === '' ||
                           currentRaise.trim() === '$' ||
                           currentRaise.trim() === '$,' ||
                           currentRaise.trim() === '$, ';

      if (opening && isOpeningEmpty) {
        setItems(p => p.map(i => i.rowIndex === rowIndex ? { ...i, openingBid: opening } : i));
        updateOpening = true;
      }
      if (raise && isRaiseEmpty) {
        setItems(p => p.map(i => i.rowIndex === rowIndex ? { ...i, minRaise: raise } : i));
        updateRaise = true;
      }
    }

    if (field === 'category') {
      try {
        const response = await fetchWithRetry(`${getBaseUrl()}/api/auction/update-item`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spreadsheetId,
            rowIndex,
            field,
            value
          })
        });
        const resData = await response.json();
        if (resData.error) throw new Error(resData.error);
        toast.success("Category updated and re-sequenced successfully!");
        fetchData();
      } catch (e: any) {
        console.error("Failed to sync category update", e);
        setItems(previousItems);
        toast.error("Failed to update category: " + e.message);
      }
      return;
    }

    // Background sync
    const syncOperations = [updateSheetData(spreadsheetId, `Auction-Items!${colLetter}${rowIndex}`, [[finalValueToSave]])];
    if (updateOpening) {
      syncOperations.push(updateSheetData(spreadsheetId, `Auction-Items!F${rowIndex}`, [[opening]]));
    }
    if (updateRaise) {
      syncOperations.push(updateSheetData(spreadsheetId, `Auction-Items!G${rowIndex}`, [[raise]]));
    }

    Promise.all(syncOperations)
      .then(() => toast.success('Saved successfully'))
      .catch(e => {
        console.error(e);
        // Rollback
        setItems(previousItems);
        toast.error("Failed to sync updates—retrying... local state reverted.");
      });
  };

  const openAddItemDialog = () => {
    setAddItemIdempotencyKey(window.crypto.randomUUID());
    setIsAddingItem(true);
  };

  const handleAddItem = async () => {
    if (!spreadsheetId) return;
    if (!newItem.name || !newItem.category) {
      toast.error("Name and Category are required");
      return;
    }

    setIsSubmittingItem(true);
    const previousItems = [...items];

    try {
      // Call server endpoint to handle add + transactional resequencing
      const response = await fetchWithRetry(`${getBaseUrl()}/api/auction/add-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId,
          category: newItem.category,
          name: newItem.name,
          description: newItem.description || "",
          value: newItem.value || "",
          donor: newItem.donor || "",
          itemType: newItem.itemType || "",
          idempotencyKey: addItemIdempotencyKey
        })
      });

      const resData = await response.json();
      if (resData.error) throw new Error(resData.error);

      const assignedId = resData.assigned_id;
      toast.success(`Item added and sequenced successfully with ID ${assignedId}`);
      await fetchData(); // Full resync to confirm and load all auction items with their proper IDs

      setNewItem({
        category: "",
        name: "",
        description: "",
        value: "",
        openingBid: "",
        minRaise: "",
        donor: "",
        itemType: "",
        status: "",
        bundleId: "",
        bundledDateTime: ""
      });
      setIsAddingItem(false);
    } catch (e: any) {
      console.error(e);
      setItems(previousItems);
      toast.error("Failed to add item: " + e.message);
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete || !spreadsheetId) return;

    setIsDeleting(true);
    const previousItems = [...items];

    try {
      // Optimistic delete
      setItems(prev => prev.filter(i => i.rowIndex !== itemToDelete.rowIndex));

      await deleteAuctionItem(spreadsheetId, itemToDelete.rowIndex);
      toast.success("Item deleted successfully");
      setItemToDelete(null);
      // Resync to get canonical row indices
      await fetchData();
    } catch (e: any) {
      console.error(e);
      setItems(previousItems);
      toast.error("Failed to delete item: " + e.message);
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    // Filter/sort/search
    sortConfig,
    requestSort,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    selectedItemType,
    setSelectedItemType,
    resetFilters,
    sortedItems,

    // Row selection
    selectedRows,
    selectedItemsCount,
    toggleRow,
    toggleAll,
    clearSelection: () => setSelectedRows({}),

    // Single-cell edits
    handleUpdate,

    // Bulk edit
    isBulkEditing,
    setIsBulkEditing,
    bulkField,
    bulkValue,
    isExecutingBulk,
    startBulkEdit,
    executeBulkUpdate,

    // Add item
    isAddingItem,
    setIsAddingItem,
    openAddItemDialog,
    newItem,
    setNewItem,
    isSubmittingItem,
    handleAddItem,

    // Delete item
    itemToDelete,
    setItemToDelete,
    isDeleting,
    handleDeleteItem,
  };
}
