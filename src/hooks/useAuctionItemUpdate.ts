import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";
import { parseDollar, calculateAutoBids, ValueCalculationTier } from "@/lib/auctionItemPricing";
import { AuctionItem } from "@/types";

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

      const { opening, raise } = calculateAutoBids(changes.value, valueCalculations);
      if (opening && !("openingBid" in changes) && isBlankAmount(targetItem.openingBid)) changes.openingBid = opening;
      if (raise && !("minRaise" in changes) && isBlankAmount(targetItem.minRaise)) changes.minRaise = raise;
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
      const response = await fetchWithRetry(`${getBaseUrl()}/api/auction/update-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, rowIndex, changes, expectedName: targetItem.name }),
      });
      const resData = await response.json().catch(() => ({}));
      if (!response.ok || resData.error) {
        const error = new Error(resData.error || "The server didn't save the change.");
        if (response.status === 409) {
          rollbackThisRow();
          toast.error(error.message);
          fetchData();
          return;
        }
        throw error;
      }
      if ("category" in changes) {
        toast.success("Category updated and re-sequenced successfully!");
        fetchData();
      } else {
        toast.success("Saved successfully");
      }
    } catch (e: any) {
      console.error("Failed to save item changes", e);
      rollbackThisRow();
      toast.error("Failed to save changes: " + e.message);
    }
  };

  return { saveItemChanges };
}
