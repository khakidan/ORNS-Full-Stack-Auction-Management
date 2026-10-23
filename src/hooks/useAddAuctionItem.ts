import { useState } from "react";
import { toast } from "sonner";
import { AuctionItem } from "@/types";
import { postJson } from "@/services/apiClient";

/**
 * The add-item dialog and its transactional add+resequence flow for the
 * auction items table. Split out of useAuctionItemsTableState.ts (was
 * 437 lines) so that container stays focused on composing the
 * split-out pieces.
 */
export function useAddAuctionItem(
  items: AuctionItem[],
  setItems: React.Dispatch<React.SetStateAction<AuctionItem[]>>,
  spreadsheetId: string,
  fetchData: () => Promise<void> | void
) {
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
    itemType: "",
    allowMultipleWinners: false
  });

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
      const resData = await postJson("/api/auction/add-item", {
        spreadsheetId,
        category: newItem.category,
        name: newItem.name,
        description: newItem.description || "",
        value: newItem.value || "",
        donor: newItem.donor || "",
        itemType: newItem.itemType || "",
        allowMultipleWinners: !!newItem.allowMultipleWinners,
        idempotencyKey: addItemIdempotencyKey
      }, "Failed to add the item");

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
        bundledDateTime: "",
        allowMultipleWinners: false
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

  return {
    isAddingItem,
    setIsAddingItem,
    openAddItemDialog,
    newItem,
    setNewItem,
    isSubmittingItem,
    handleAddItem,
  };
}
