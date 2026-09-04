import { useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, updateSheetData, getBaseUrl } from "@/services/google-api";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { AuctionItem } from "@/types";
import { BundlingSelection } from "./useAuctionItemsFilterSort";

/**
 * Bulk-edit flow for the auction items table (category or item type,
 * applied to every currently-selected row). Split out of
 * useAuctionItemsTableState.ts (was 437 lines) so that container stays
 * focused on composing the split-out pieces. Reads the row selection
 * from useAuctionItemsFilterSort.ts and clears it via `clearSelection` -
 * the same one-hook's-state-passed-into-another composition pattern
 * already used in AuctionContext.tsx.
 */
export function useAuctionItemsBulkEdit(
  items: AuctionItem[],
  setItems: React.Dispatch<React.SetStateAction<AuctionItem[]>>,
  spreadsheetId: string,
  selectedRows: BundlingSelection,
  clearSelection: () => void,
  fetchData: () => Promise<void> | void
) {
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkField, setBulkField] = useState<"category" | "itemType" | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [isExecutingBulk, setIsExecutingBulk] = useState(false);

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
        clearSelection();
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
        clearSelection();
        setIsBulkEditing(false);
        setBulkField(null);
        setBulkValue("");
      })
      .catch(() => {
        // Rollback
        setItems(previousItems);
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      })
      .finally(() => {
        setIsExecutingBulk(false);
      });
  };

  return {
    isBulkEditing,
    setIsBulkEditing,
    bulkField,
    bulkValue,
    isExecutingBulk,
    startBulkEdit,
    executeBulkUpdate,
  };
}
