import { toast } from "sonner";
import { parseDollar, calculateAutoBids, ValueCalculationTier } from "@/lib/auctionItemPricing";
import { AuctionItem } from "@/types";
import { postJson, HttpError } from "@/services/apiClient";

export interface AuctionItemEditChange {
  field: keyof AuctionItem;
  value: string | boolean;
}

/** "", "$", "$," and "$, " all count as no amount entered yet. */
function isBlankAmount(amount: string | undefined): boolean {
  return !amount || ["", "$", "$,", "$, "].includes(amount.trim());
}

/**
 * Save handler for the auction items table's Edit dialog
 * (`saveItemChanges`), including the value-edit auto-bid side effect
 * (filling a blank opening bid/min raise from the value).
 *
 * Every changed field goes to the server's locked /api/auction/update-item
 * in one request - never a direct cell write - so an edit can't be lost
 * to another staff member's add/delete/bundle rewriting the sheet at the
 * same moment. The server also checks the row still holds this item (by
 * name, since IDs renumber) and answers 409 if it doesn't.
 */
export function useAuctionItemUpdate(
  items: AuctionItem[],
  setItems: React.Dispatch<React.SetStateAction<AuctionItem[]>>,
  spreadsheetId: string,
  valueCalculations: ValueCalculationTier[],
  fetchData: () => Promise<void> | void
) {
  const saveItemChanges = async (rowIndex: number, edits: AuctionItemEditChange[]) => {
    if (!spreadsheetId || edits.length === 0) return;

    const targetItem = items.find(i => i.rowIndex === rowIndex);
    if (!targetItem) return;

    const changes: Record<string, string | boolean> = {};
    for (const { field, value } of edits) {
      changes[field] = value;
    }

    if (typeof changes.value === "string" && changes.value) {
      const parsedNum = parseDollar(changes.value);
      if (parsedNum > 0) changes.value = `$${parsedNum.toFixed(2)}`;
    }

    // When this save changes the value or clears an amount, fill in any
    // opening bid / min raise that would be left blank, from the item's
    // (new) value. An amount the user typed is never overwritten.
    if ("value" in changes || "openingBid" in changes || "minRaise" in changes) {
      const finalValue = String(changes.value ?? targetItem.value ?? "");
      const { opening, raise } = calculateAutoBids(finalValue, valueCalculations);
      const finalOpening = "openingBid" in changes ? String(changes.openingBid) : targetItem.openingBid;
      const finalRaise = "minRaise" in changes ? String(changes.minRaise) : targetItem.minRaise;
      if (opening && isBlankAmount(finalOpening)) changes.openingBid = opening;
      if (raise && isBlankAmount(finalRaise)) changes.minRaise = raise;
    }

    // Only the fields this save changed are rolled back on failure - not
    // a whole-array snapshot, which would also erase another row's edit
    // that committed in the meantime.
    const changedFields = Object.keys(changes) as (keyof AuctionItem)[];
    const previous = Object.fromEntries(changedFields.map(f => [f, targetItem[f]]));
    const rollbackThisRow = () => {
      setItems(prev => prev.map(item => item.rowIndex === rowIndex ? { ...item, ...previous } : item));
    };

    setItems(prev => prev.map(item => item.rowIndex === rowIndex ? ({ ...item, ...changes } as AuctionItem) : item));

    try {
      await postJson("/api/auction/update-item", { spreadsheetId, rowIndex, changes, expectedName: targetItem.name }, "The server didn't save the change.");
      if ("category" in changes) {
        toast.success("Category updated and re-sequenced successfully!");
        fetchData();
      } else {
        toast.success("Saved successfully");
      }
    } catch (e: any) {
      rollbackThisRow();
      if (e instanceof HttpError && e.status === 409) {
        // Someone else changed this item meanwhile - say so and reload it.
        toast.error(e.message);
        fetchData();
        return;
      }
      console.error("Failed to save item changes", e);
      toast.error("Failed to save changes: " + e.message);
    }
  };

  return { saveItemChanges };
}
