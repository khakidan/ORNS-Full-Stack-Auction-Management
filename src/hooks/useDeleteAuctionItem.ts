import { useState } from "react";
import { toast } from "sonner";
import { deleteAuctionItem } from "@/services/google-api";
import { AuctionItem } from "@/types";

/**
 * The delete-item confirmation flow for the auction items table. Split
 * out of useAuctionItemsTableState.ts (was 437 lines) so that container
 * stays focused on composing the split-out pieces.
 */
export function useDeleteAuctionItem(
  items: AuctionItem[],
  setItems: React.Dispatch<React.SetStateAction<AuctionItem[]>>,
  spreadsheetId: string,
  fetchData: () => Promise<void> | void
) {
  const [itemToDelete, setItemToDelete] = useState<AuctionItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
    itemToDelete,
    setItemToDelete,
    isDeleting,
    handleDeleteItem,
  };
}
