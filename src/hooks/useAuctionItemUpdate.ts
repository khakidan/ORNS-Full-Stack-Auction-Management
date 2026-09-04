import { toast } from "sonner";
import { fetchWithRetry, updateSheetData, getBaseUrl } from "@/services/google-api";
import { parseDollar, calculateAutoBids, ValueCalculationTier } from "@/lib/auctionItemPricing";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { AuctionItem } from "@/types";

/**
 * Single-cell edit handler for the auction items table (`handleUpdate`),
 * including the value-edit auto-bid side effects (opening bid/min raise
 * auto-fill) and the category field's special resequencing endpoint.
 * Split out of useAuctionItemsTableState.ts (was 437 lines) so that
 * container stays focused on composing the split-out pieces.
 */
export function useAuctionItemUpdate(
  items: AuctionItem[],
  setItems: React.Dispatch<React.SetStateAction<AuctionItem[]>>,
  spreadsheetId: string,
  valueCalculations: ValueCalculationTier[],
  fetchData: () => Promise<void> | void
) {
  const handleUpdate = async (rowIndex: number, field: keyof AuctionItem, colLetter: string, value: string) => {
    if (!spreadsheetId) return;

    const targetItem = items.find(i => i.rowIndex === rowIndex);
    if (!targetItem) return;

    // Captured per-field, not a whole-array snapshot - a rollback here must
    // only revert what THIS call changed on THIS row. Restoring a captured
    // full-array snapshot would also erase any other row's edit that
    // happened to commit in the window between this optimistic update and
    // its own failure.
    const previousFieldValue = targetItem[field];
    const previousOpeningBid = targetItem.openingBid;
    const previousMinRaise = targetItem.minRaise;

    const rollbackThisRow = () => {
      setItems(prev => prev.map(item => {
        if (item.rowIndex !== rowIndex) return item;
        const restored = { ...item, [field]: previousFieldValue };
        if (updateOpening) restored.openingBid = previousOpeningBid;
        if (updateRaise) restored.minRaise = previousMinRaise;
        return restored;
      }));
    };

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
        rollbackThisRow();
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
        rollbackThisRow();
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      });
  };

  return { handleUpdate };
}
