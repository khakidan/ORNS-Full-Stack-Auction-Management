/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQuickBidEntryState } from "./useQuickBidEntryState";
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

describe("useQuickBidEntryState - validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows an error and does not record when the item number doesn't resolve", async () => {
    const recordWinningBid = vi.fn();
    const { result } = renderHook(() => useQuickBidEntryState({ items: [], bidders: [], winners: {}, recordWinningBid }));

    act(() => { result.current.handleSubmit(); });

    expect(recordWinningBid).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Please fill in a valid item number");
  });

  it("shows an error and does not record when the bidder ID doesn't resolve", async () => {
    const recordWinningBid = vi.fn();
    const { result } = renderHook(() => useQuickBidEntryState({ items: [makeItem()], bidders: [], winners: {}, recordWinningBid }));

    act(() => { result.current.setItemId("1301"); });
    act(() => { result.current.handleSubmit(); });

    expect(recordWinningBid).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Please fill in a valid bidder number");
  });

  it("blocks a non-checked-in, non-proxy bidder", async () => {
    const recordWinningBid = vi.fn();
    const bidder = makeBidder({ checkedIn: false, isProxy: false });
    const { result } = renderHook(() => useQuickBidEntryState({ items: [makeItem()], bidders: [bidder], winners: {}, recordWinningBid }));

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("50"); });
    act(() => { result.current.handleSubmit(); });

    expect(recordWinningBid).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Bidder must be checked in (or be a proxy bidder)");
  });

  it("does not resolve an item/bidder against a row with a blank id, even when the field is empty", () => {
    const items = [makeItem({ id: "", name: "Blank Row Item" })];
    const bidders = [makeBidder({ id: "", firstName: "Blank", lastName: "Row" })];
    const { result } = renderHook(() => useQuickBidEntryState({ items, bidders, winners: {}, recordWinningBid: vi.fn() }));

    expect(result.current.selectedItem).toBeUndefined();
    expect(result.current.selectedBidder).toBeUndefined();
  });
});

describe("useQuickBidEntryState - happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records the bid, clears the form, and appends a 'recorded' feed entry", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useQuickBidEntryState({ items: [makeItem()], bidders: [makeBidder()], winners: {}, recordWinningBid })
    );

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("150"); });
    await act(async () => { await result.current.handleSubmit(); });

    expect(recordWinningBid).toHaveBeenCalledWith("142", "1301", 150);
    expect(result.current.itemId).toBe("");
    expect(result.current.bidderId).toBe("");
    expect(result.current.price).toBe("");
    expect(result.current.feed).toHaveLength(1);
    expect(result.current.feed[0]).toMatchObject({ itemId: "1301", bidderId: "142", price: 150, outcome: "recorded" });
  });

  it("surfaces the rollback error via toast without clearing the form when recordWinningBid throws", async () => {
    const recordWinningBid = vi.fn().mockRejectedValue(new Error("Sync failed"));
    const { result } = renderHook(() =>
      useQuickBidEntryState({ items: [makeItem()], bidders: [makeBidder()], winners: {}, recordWinningBid })
    );

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("150"); });
    await act(async () => { await result.current.handleSubmit(); });

    expect(toast.error).toHaveBeenCalledWith("Sync failed");
    expect(result.current.itemId).toBe("1301");
    expect(result.current.feed).toHaveLength(0);
  });
});

describe("useQuickBidEntryState - duplicate/repeatable handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks recording a second winner for a non-repeatable item that already has one, and logs a blocked-duplicate feed entry", async () => {
    const recordWinningBid = vi.fn();
    const item = makeItem({ allowMultipleWinners: false });
    const { result } = renderHook(() =>
      useQuickBidEntryState({ items: [item], bidders: [makeBidder()], winners: { "1301": "Jane Doe" }, recordWinningBid })
    );

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("150"); });
    act(() => { result.current.handleSubmit(); });

    expect(recordWinningBid).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("already has a winning bid (Jane Doe)"));
    expect(result.current.feed).toHaveLength(1);
    expect(result.current.feed[0].outcome).toBe("blocked-duplicate");
  });

  it("allows recording a repeatable item even when it already has a winner", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue(undefined);
    const item = makeItem({ allowMultipleWinners: true });
    const { result } = renderHook(() =>
      useQuickBidEntryState({ items: [item], bidders: [makeBidder()], winners: { "1301": "Jane Doe" }, recordWinningBid })
    );

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("20"); });
    await act(async () => { await result.current.handleSubmit(); });

    expect(recordWinningBid).toHaveBeenCalledWith("142", "1301", 20);
    expect(result.current.feed[0].outcome).toBe("recorded");
  });

  it("tallies 'sold this session' only from this session's own recorded entries for that item", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue(undefined);
    const item = makeItem({ allowMultipleWinners: true });
    const { result } = renderHook(() =>
      useQuickBidEntryState({ items: [item], bidders: [makeBidder()], winners: {}, recordWinningBid })
    );

    expect(result.current.soldCountThisSession).toBe(0);

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("20"); });
    await act(async () => { await result.current.handleSubmit(); });

    act(() => { result.current.setItemId("1301"); });
    expect(result.current.soldCountThisSession).toBe(1);
  });

  it("does not block a non-repeatable item that has no existing winner", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue(undefined);
    const item = makeItem({ allowMultipleWinners: false });
    const { result } = renderHook(() =>
      useQuickBidEntryState({ items: [item], bidders: [makeBidder()], winners: {}, recordWinningBid })
    );

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("150"); });
    await act(async () => { await result.current.handleSubmit(); });

    expect(recordWinningBid).toHaveBeenCalledTimes(1);
    expect(recordWinningBid).toHaveBeenCalledWith("142", "1301", 150);
  });
});

describe("useQuickBidEntryState - amount checks", () => {
  beforeEach(() => vi.clearAllMocks());
  const pricedItem = () => makeItem({ value: "$100.00", openingBid: "$45.00", minRaise: "$5.00" });

  it("shows a warning as you type, asks before recording, and records once confirmed", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue("key");
    const { result } = renderHook(() => useQuickBidEntryState({ items: [pricedItem()], bidders: [makeBidder()], winners: {}, recordWinningBid }));

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("15"); });
    expect(result.current.warnings).toEqual([expect.stringContaining("below the opening bid")]);

    await act(async () => { await result.current.handleSubmit(); });
    expect(result.current.confirmingWarnings).toBe(true);
    expect(recordWinningBid).not.toHaveBeenCalled();

    await act(async () => { await result.current.handleSubmit({ confirmed: true }); });
    expect(recordWinningBid).toHaveBeenCalledWith("142", "1301", 15);
    expect(result.current.confirmingWarnings).toBe(false);
  });

  it("'Fix it' closes the question without recording", async () => {
    const recordWinningBid = vi.fn();
    const { result } = renderHook(() => useQuickBidEntryState({ items: [pricedItem()], bidders: [makeBidder()], winners: {}, recordWinningBid }));

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("1500"); });
    await act(async () => { await result.current.handleSubmit(); });
    act(() => { result.current.cancelWarnings(); });

    expect(result.current.confirmingWarnings).toBe(false);
    expect(recordWinningBid).not.toHaveBeenCalled();
  });

  it("records a believable amount straight away, with no question", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue("key");
    const { result } = renderHook(() => useQuickBidEntryState({ items: [pricedItem()], bidders: [makeBidder()], winners: {}, recordWinningBid }));

    act(() => { result.current.setItemId("1301"); result.current.setBidderId("142"); result.current.setPrice("150"); });
    await act(async () => { await result.current.handleSubmit(); });

    expect(result.current.confirmingWarnings).toBe(false);
    expect(recordWinningBid).toHaveBeenCalledWith("142", "1301", 150);
  });
});
