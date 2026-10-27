import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AuctionItem, Bidder } from "@/types";
import { bidWarnings } from "@/lib/bidSanityChecks";

export interface BatchRow {
  key: string;
  itemId: string;
  bidderId: string;
  price: string;
  /** "Looks right" was clicked for this row's price warnings; any edit clears it. */
  confirmed?: boolean;
}

/** "check": the amount looks mistyped (bidSanityChecks.ts) and hasn't been confirmed. */
export type BatchRowStatus = "empty" | "ready" | "ready-repeat" | "duplicate" | "check" | "error";

interface UseBatchBidEntryStateArgs {
  items: AuctionItem[];
  bidders: Bidder[];
  winners: Record<string, string>;
  recordWinningBid: (bidderId: string, itemId: string, price: number) => Promise<string | void>;
}

function makeEmptyRow(): BatchRow {
  return { key: crypto.randomUUID(), itemId: "", bidderId: "", price: "" };
}

/**
 * State for the Bid Entry redesign's "Batch Entry" mode: a spreadsheet-
 * style grid meant for the big 30-60 item wave, per the user's own
 * description of their auction's bid-collection pattern. Every row is
 * resolved (item/bidder lookup, duplicate/repeatable check) as it's
 * typed, but nothing is recorded until "Record N Ready Bids" is
 * clicked - only rows with no problem are submitted, matching what the
 * user approved in the Artifact mockup.
 */
export function useBatchBidEntryState({ items, bidders, winners, recordWinningBid }: UseBatchBidEntryStateArgs) {
  const [rows, setRows] = useState<BatchRow[]>(() => [makeEmptyRow(), makeEmptyRow(), makeEmptyRow()]);
  const [submitting, setSubmitting] = useState(false);

  const updateRow = (key: string, field: keyof Omit<BatchRow, "key">, value: string) => {
    setRows(prev => {
      const next = prev.map(r => (r.key === key ? { ...r, [field]: value, confirmed: false } : r));
      // Auto-append a fresh trailing row once the last row has any input,
      // so the grid always has room to keep transcribing without an
      // explicit "Add Row" click for every single line.
      const last = next[next.length - 1];
      if (last.itemId || last.bidderId || last.price) {
        next.push(makeEmptyRow());
      }
      return next;
    });
  };

  const removeRow = (key: string) => {
    setRows(prev => {
      const next = prev.filter(r => r.key !== key);
      return next.length > 0 ? next : [makeEmptyRow()];
    });
  };

  const addRow = () => setRows(prev => [...prev, makeEmptyRow()]);

  const confirmRow = (key: string) => setRows(prev => prev.map(r => (r.key === key ? { ...r, confirmed: true } : r)));

  const resolved = useMemo(() => {
    // Item IDs appearing more than once within the batch itself, for a
    // non-repeatable item - two paper slips for the same lot turned in
    // in the same stack is exactly the mistake this is meant to catch,
    // independent of whether that item already has a winner on record.
    const idCounts = new Map<string, number>();
    for (const row of rows) {
      if (!row.itemId.trim()) continue;
      idCounts.set(row.itemId, (idCounts.get(row.itemId) || 0) + 1);
    }

    return rows.map(row => {
      const hasAnyInput = !!(row.itemId.trim() || row.bidderId.trim() || row.price.trim());
      const item = row.itemId.trim() ? items.find(i => i.id === row.itemId) : undefined;
      const bidder = row.bidderId.trim() ? bidders.find(b => b.id === row.bidderId) : undefined;

      let status: BatchRowStatus = "empty";
      const warnings = item && row.price.trim() ? bidWarnings(item, parseFloat(row.price)) : [];
      if (hasAnyInput) {
        const isRepeatable = !!item?.allowMultipleWinners;
        const existingWinner = item ? winners[item.id] : undefined;
        const duplicateWithinBatch = !isRepeatable && (idCounts.get(row.itemId) || 0) > 1;

        if (!item || !bidder || !row.price.trim()) {
          status = "error";
        } else if (!isRepeatable && (existingWinner || duplicateWithinBatch)) {
          status = "duplicate";
        } else if (warnings.length > 0 && !row.confirmed) {
          status = "check";
        } else if (isRepeatable) {
          status = "ready-repeat";
        } else {
          status = "ready";
        }
      }

      return { row, item, bidder, status, hasAnyInput, warnings };
    });
  }, [rows, items, bidders, winners]);

  const readyRows = resolved.filter(r => r.status === "ready" || r.status === "ready-repeat");

  const submitReady = async () => {
    if (readyRows.length === 0) return;
    setSubmitting(true);
    try {
      // recordWinningBid is fire-and-forget by design (optimistic update,
      // background sync, its own success/rollback toast per call - see
      // useWinnersData.ts) - it never actually rejects except for a
      // missing spreadsheetId, a global config problem that would affect
      // every row identically, not a per-row failure to recover from
      // here. Each row's real outcome surfaces via its own toast, same
      // as Quick Entry already does one row at a time.
      const readyKeys = new Set(readyRows.map(r => r.row.key));
      await Promise.all(
        readyRows.map(r => recordWinningBid(r.row.bidderId, r.row.itemId, parseFloat(r.row.price) || 0))
      );

      setRows(prev => {
        const remaining = prev.filter(r => !readyKeys.has(r.key));
        return remaining.length > 0 ? remaining : [makeEmptyRow()];
      });
      toast.success(`Recorded ${readyRows.length} winning bid${readyRows.length === 1 ? "" : "s"}.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to record bids.");
    } finally {
      setSubmitting(false);
    }
  };

  return {
    rows,
    resolved,
    readyRows,
    submitting,
    updateRow,
    removeRow,
    addRow,
    confirmRow,
    submitReady,
  };
}
