import { useState } from "react";
import { toast } from "sonner";
import { AuctionItem } from "@/types";
import { BundlingSelection } from "./useAuctionItemsFilterSort";
import { postJson } from "@/services/apiClient";

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

    // Both fields go through the server's locked bulk route (category also
    // renumbers IDs there), never direct cell writes.
    try {
      await postJson("/api/auction/bulk-update-items", {
        spreadsheetId,
        rowIndices: selectedIndices,
        field: bulkField,
        value: bulkValue,
        // Made once here so the request's retries reuse it and the server
        // applies the change only once.
        idempotencyKey: window.crypto.randomUUID(),
      }, "The server didn't save the change.");
      toast.success(bulkField === "category"
        ? "Bulk categories updated and re-sequenced successfully!"
        : `Updated item type for ${selectedIndices.length} items`);
      clearSelection();
      setIsBulkEditing(false);
      setBulkField(null);
      setBulkValue("");
      if (bulkField === "category") fetchData();
    } catch (e: any) {
      console.error(`Bulk ${bulkField} update failed:`, e);
      setItems(previousItems);
      toast.error(`Failed to bulk update ${bulkField === "category" ? "categories" : "item types"}: ` + e.message);
    } finally {
      setIsExecutingBulk(false);
    }
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
