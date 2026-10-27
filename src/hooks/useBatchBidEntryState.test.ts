/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBatchBidEntryState } from "./useBatchBidEntryState";
import { AuctionItem, Bidder } from "@/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
import { toast } from "sonner";

function makeItem(overrides: Partial<AuctionItem> = {}): AuctionItem {
  return {
    id: "1301", name: "Sample Item", category: "", description: "", value: "", openingBid: "",
    minRaise: "", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "",
    rowIndex: 2, ...overrides,
  };
}

function makeBidder(overrides: Partial<Bidder> = {}): Bidder {
  return {
    id: "142", firstName: "Test", lastName: "Bidder", email: "", checkedIn: true, isProxy: false,
    checkedOut: false, paid: false, rowIndex: 2, ...overrides,
  };
}

describe("useBatchBidEntryState - row resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts with 3 empty rows, all status 'empty'", () => {
    const { result } = renderHook(() => useBatchBidEntryState({ items: [], bidders: [], winners: {}, recordWinningBid: vi.fn() }));
    expect(result.current.rows).toHaveLength(3);
    expect(result.current.resolved.every(r => r.status === "empty")).toBe(true);
  });

  it("marks a row 'ready' once item, bidder, and price all resolve", () => {
    const { result } = renderHook(() =>
      useBatchBidEntryState({ items: [makeItem()], bidders: [makeBidder()], winners: {}, recordWinningBid: vi.fn() })
    );
    const key = result.current.rows[0].key;

    act(() => { result.current.updateRow(key, "itemId", "1301"); });
    act(() => { result.current.updateRow(key, "bidderId", "142"); });
    act(() => { result.current.updateRow(key, "price", "150"); });

    expect(result.current.resolved[0].status).toBe("ready");
  });

  it("marks a row 'error' when the item number or bidder number doesn't resolve", () => {
    const { result } = renderHook(() =>
      useBatchBidEntryState({ items: [], bidders: [], winners: {}, recordWinningBid: vi.fn() })
    );
    const key = result.current.rows[0].key;

    act(() => { result.current.updateRow(key, "itemId", "9999"); });
    expect(result.current.resolved[0].status).toBe("error");
  });

  it("marks a row 'duplicate' when the item already has a winner and isn't repeatable", () => {
    const { result } = renderHook(() =>
      useBatchBidEntryState({
        items: [makeItem({ allowMultipleWinners: false })],
        bidders: [makeBidder()],
        winners: { "1301": "Existing Winner" },
        recordWinningBid: vi.fn(),
      })
    );
    const key = result.current.rows[0].key;

    act(() => { result.current.updateRow(key, "itemId", "1301"); });
    act(() => { result.current.updateRow(key, "bidderId", "142"); });
    act(() => { result.current.updateRow(key, "price", "150"); });

    expect(result.current.resolved[0].status).toBe("duplicate");
  });

  it("marks a row 'duplicate' when the same non-repeatable item appears twice within the batch itself", () => {
    const { result } = renderHook(() =>
      useBatchBidEntryState({
        items: [makeItem({ allowMultipleWinners: false })],
        bidders: [makeBidder(), makeBidder({ id: "200" })],
        winners: {},
        recordWinningBid: vi.fn(),
      })
    );
    const [row1, row2] = result.current.rows;

    act(() => {
      result.current.updateRow(row1.key, "itemId", "1301");
      result.current.updateRow(row1.key, "bidderId", "142");
      result.current.updateRow(row1.key, "price", "150");
    });
    act(() => {
      result.current.updateRow(row2.key, "itemId", "1301");
      result.current.updateRow(row2.key, "bidderId", "200");
      result.current.updateRow(row2.key, "price", "150");
    });

    expect(result.current.resolved[0].status).toBe("duplicate");
    expect(result.current.resolved[1].status).toBe("duplicate");
  });

  it("marks a row 'ready-repeat' (not 'duplicate') for a repeatable item that already has a winner", () => {
    const { result } = renderHook(() =>
      useBatchBidEntryState({
        items: [makeItem({ allowMultipleWinners: true })],
        bidders: [makeBidder()],
        winners: { "1301": "Someone Else" },
        recordWinningBid: vi.fn(),
      })
    );
    const key = result.current.rows[0].key;

    act(() => {
      result.current.updateRow(key, "itemId", "1301");
      result.current.updateRow(key, "bidderId", "142");
      result.current.updateRow(key, "price", "20");
    });

    expect(result.current.resolved[0].status).toBe("ready-repeat");
  });

  it("auto-appends a fresh trailing row once the last row gets any input", () => {
    const { result } = renderHook(() => useBatchBidEntryState({ items: [], bidders: [], winners: {}, recordWinningBid: vi.fn() }));
    const lastKey = result.current.rows[result.current.rows.length - 1].key;

    act(() => { result.current.updateRow(lastKey, "itemId", "1301"); });

    expect(result.current.rows).toHaveLength(4);
  });
});

describe("useBatchBidEntryState - row management", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removeRow removes exactly that row, keeping at least one row", () => {
    const { result } = renderHook(() => useBatchBidEntryState({ items: [], bidders: [], winners: {}, recordWinningBid: vi.fn() }));
    const targetKey = result.current.rows[1].key;

    act(() => { result.current.removeRow(targetKey); });

    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows.some(r => r.key === targetKey)).toBe(false);
  });

  it("removeRow on the last remaining row leaves one fresh empty row instead of zero", () => {
    const { result } = renderHook(() => useBatchBidEntryState({ items: [], bidders: [], winners: {}, recordWinningBid: vi.fn() }));

    act(() => { result.current.rows.forEach(r => result.current.removeRow(r.key)); });

    expect(result.current.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("addRow appends one more empty row", () => {
    const { result } = renderHook(() => useBatchBidEntryState({ items: [], bidders: [], winners: {}, recordWinningBid: vi.fn() }));
    const before = result.current.rows.length;

    act(() => { result.current.addRow(); });

    expect(result.current.rows.length).toBe(before + 1);
  });
});

describe("useBatchBidEntryState - submitReady", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records only the ready rows, leaving duplicate/error rows in the grid", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useBatchBidEntryState({
        items: [makeItem(), makeItem({ id: "1302", name: "Other Item" })],
        bidders: [makeBidder()],
        winners: { "1302": "Already Won" },
        recordWinningBid,
      })
    );
    const [readyRow, dupRow] = result.current.rows;

    act(() => {
      result.current.updateRow(readyRow.key, "itemId", "1301");
      result.current.updateRow(readyRow.key, "bidderId", "142");
      result.current.updateRow(readyRow.key, "price", "150");
    });
    act(() => {
      result.current.updateRow(dupRow.key, "itemId", "1302");
      result.current.updateRow(dupRow.key, "bidderId", "142");
      result.current.updateRow(dupRow.key, "price", "50");
    });

    await act(async () => { await result.current.submitReady(); });

    expect(recordWinningBid).toHaveBeenCalledTimes(1);
    expect(recordWinningBid).toHaveBeenCalledWith("142", "1301", 150);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Recorded 1 winning bid"));
    // The duplicate row's item id must still be in the grid - not submitted, not dropped.
    expect(result.current.rows.some(r => r.itemId === "1302")).toBe(true);
  });

  it("does nothing when there are no ready rows", async () => {
    const recordWinningBid = vi.fn();
    const { result } = renderHook(() => useBatchBidEntryState({ items: [], bidders: [], winners: {}, recordWinningBid }));

    await act(async () => { await result.current.submitReady(); });

    expect(recordWinningBid).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("useBatchBidEntryState - amount checks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("holds back a row whose amount looks mistyped until 'Looks right', and asks again after an edit", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue(undefined);
    const item = makeItem({ value: "$100.00", openingBid: "$45.00", minRaise: "$5.00" });
    const { result } = renderHook(() =>
      useBatchBidEntryState({ items: [item], bidders: [makeBidder()], winners: {}, recordWinningBid })
    );
    const key = result.current.rows[0].key;

    act(() => { result.current.updateRow(key, "itemId", "1301"); });
    act(() => { result.current.updateRow(key, "bidderId", "142"); });
    act(() => { result.current.updateRow(key, "price", "1500"); });
    expect(result.current.resolved[0].status).toBe("check");
    expect(result.current.readyRows).toHaveLength(0);

    act(() => { result.current.confirmRow(key); });
    expect(result.current.resolved[0].status).toBe("ready");

    act(() => { result.current.updateRow(key, "price", "15"); });
    expect(result.current.resolved[0].status).toBe("check");

    act(() => { result.current.updateRow(key, "price", "150"); });
    expect(result.current.resolved[0].status).toBe("ready");
  });
});
