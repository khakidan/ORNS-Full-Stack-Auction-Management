/**
 * @vitest-environment jsdom
 *
 * useWinnersData is only ever consumed through Checkout.tsx (via
 * useCheckoutState.ts), and Checkout.test.tsx mocks useCheckoutState
 * wholesale - so none of this hook's real logic has ever run under the
 * test suite. Tested directly via renderHook, matching the pattern
 * already established for useBiddersData.ts/useBundling.ts.
 *
 * recordWinningBid's rollback is the exact "whole stale snapshot" bug
 * flagged in CHANGELOG.md: it used to restore the entire
 * captured winners map/total on failure, so two bids recorded in quick
 * succession (before a re-render) both capture the same baseline - if
 * the second fails, its rollback erased the first bid's already-
 * committed change too. Fixed to scope the rollback to just the one
 * item/amount this call touched, matching the pattern already applied
 * to useAuctionItemsTableState.ts's handleUpdate.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWinnersData } from "./useWinnersData";
import { AuctionItem, Bidder } from "@/types";

vi.mock("@/services/google-api", () => ({
  getSheetData: vi.fn(),
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  ServerUnreachableError: class ServerUnreachableError extends Error {},
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { getSheetData, fetchWithRetry, ServerUnreachableError } from "@/services/google-api";
import { toast } from "sonner";
import { addToOutbox, getOutboxState, _resetOutboxForTesting } from "@/lib/bidOutbox";

const mockedGetSheetData = vi.mocked(getSheetData);
const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

function makeItem(overrides: Partial<AuctionItem> = {}): AuctionItem {
  return {
    id: "item1",
    name: "Vintage Wine Basket",
    category: "Food",
    description: "",
    value: "$100.00",
    openingBid: "$45.00",
    minRaise: "$5.00",
    donor: "",
    itemType: "Physical Item",
    status: "Active",
    bundleId: "",
    bundledDateTime: "",
    rowIndex: 2,
    ...overrides,
  };
}

function makeBidder(overrides: Partial<Bidder> = {}): Bidder {
  return {
    id: "101",
    firstName: "Alice",
    lastName: "One",
    email: "alice@example.com",
    checkedIn: true,
    isProxy: false,
    checkedOut: false,
    paid: false,
    rowIndex: 2,
    ...overrides,
  };
}

// Column-pair grid shape parseBidGrid expects (see bidGridParsing.test.ts):
// header row holds bidder IDs in pairs, rows 1-2 are unrelated header rows,
// data starts at row index 3.
const BID_GRID_HEADER = ["101", "", "102", ""];
const ROW1 = ["Header", "Details", "Header", "Details"];
const ROW2 = ["More", "Stuff", "More", "Stuff"];

describe("useWinnersData.fetchWinners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the winners map with bidder names and sums totalRaised", async () => {
    const bidders = [makeBidder({ id: "101", firstName: "Alice", lastName: "One" }), makeBidder({ id: "102", firstName: "Bob", lastName: "Two" })];
    mockedGetSheetData.mockResolvedValue({
      values: [BID_GRID_HEADER, ROW1, ROW2, ["item1", "$50.00", "item2", "$75.00"]],
    });

    const { result } = renderHook(() => useWinnersData("ss-id", bidders, [], "Bid-Management", "Bidder-Numbers"));
    await act(async () => {
      await result.current.fetchWinners();
    });

    expect(result.current.winners).toEqual({ item1: "Alice One", item2: "Bob Two" });
    expect(result.current.totalRaised).toBe(125);
  });

  it("falls back to 'Bidder <id>' when the winning bidder isn't in the bidders list", async () => {
    mockedGetSheetData.mockResolvedValue({
      values: [BID_GRID_HEADER, ROW1, ROW2, ["item1", "$50.00", "", ""]],
    });

    // A non-empty bidders list that just doesn't include bidder 101 - an
    // empty list would trip the hook's own `bidders.length === 0` no-op
    // guard and never reach the fetch at all.
    const { result } = renderHook(() => useWinnersData("ss-id", [makeBidder({ id: "999" })], [], "Bid-Management", "Bidder-Numbers"));
    await act(async () => {
      await result.current.fetchWinners();
    });

    expect(result.current.winners).toEqual({ item1: "Bidder 101" });
  });

  it("does nothing when spreadsheetId is empty", async () => {
    const { result } = renderHook(() => useWinnersData("", [makeBidder()], [], "Bid-Management", "Bidder-Numbers"));
    await act(async () => {
      await result.current.fetchWinners();
    });

    expect(getSheetData).not.toHaveBeenCalled();
  });

  it("does nothing when there are no bidders yet", async () => {
    const { result } = renderHook(() => useWinnersData("ss-id", [], [], "Bid-Management", "Bidder-Numbers"));
    await act(async () => {
      await result.current.fetchWinners();
    });

    expect(getSheetData).not.toHaveBeenCalled();
  });

  it("swallows a fetch failure without throwing or crashing", async () => {
    mockedGetSheetData.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useWinnersData("ss-id", [makeBidder()], [], "Bid-Management", "Bidder-Numbers"));

    await expect(act(async () => {
      await result.current.fetchWinners();
    })).resolves.not.toThrow();

    expect(result.current.winners).toEqual({});
  });
});

describe("useWinnersData.recordWinningBid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when spreadsheetId is not configured", async () => {
    const { result } = renderHook(() => useWinnersData("", [], [], "Bid-Management", "Bidder-Numbers"));

    await expect(result.current.recordWinningBid("101", "item1", 50)).rejects.toThrow("Spreadsheet ID not configured");
  });

  it("applies the optimistic update immediately, before the network call settles", async () => {
    let resolveFetch: (v: any) => void;
    mockedFetchWithRetry.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const bidders = [makeBidder({ id: "101", firstName: "Alice", lastName: "One" })];
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, [], "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      result.current.recordWinningBid("101", "item1", 50);
    });

    expect(result.current.winners).toEqual({ item1: "Alice One" });
    expect(result.current.totalRaised).toBe(50);

    await act(async () => {
      resolveFetch!({ ok: true, json: async () => ({ success: true, followUpAdded: false }) });
    });
  });

  it("posts the real payload and shows a success toast on the happy path", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ success: true, followUpAdded: false }) } as Response);
    const bidders = [makeBidder({ id: "101", firstName: "Alice", lastName: "One" })];
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, [], "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(fetchWithRetry).toHaveBeenCalledWith(
      "http://localhost:3000/api/auction/record-winning-bid",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.stringContaining('"bidderId":"101"'),
      })
    );
    const body = JSON.parse((fetchWithRetry as any).mock.calls[0][1].body);
    expect(body).toMatchObject({ bidderId: "101", itemId: "item1", price: 50, spreadsheetId: "ss-id", bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers" });
    expect(toast.success).toHaveBeenCalledWith("Synced bid: Alice One — item1 — $50");
  });

  it("shows a persistent, explicitly-confirmed Checked Out Warning naming the item - per patterns.md's winner-notification rule - when the bidder had already checked out", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ success: true, followUpAdded: true }) } as Response);
    const bidders = [makeBidder({ id: "101", firstName: "Alice", lastName: "One" })];
    const items = [makeItem({ id: "item1", name: "Vintage Wine Basket" })];
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, items, "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(toast.warning).toHaveBeenCalledWith("Checked Out Warning", {
      description: 'Warning: Alice One won "Vintage Wine Basket" but has already checked out.',
      duration: Infinity,
      action: expect.objectContaining({ label: "I have confirmed" }),
    });
  });

  it("falls back to 'Item <id>' in the Checked Out Warning when the item isn't in the items list", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ success: true, followUpAdded: true }) } as Response);
    const { result } = renderHook(() => useWinnersData("ss-id", [makeBidder()], [], "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(toast.warning).toHaveBeenCalledWith("Checked Out Warning", expect.objectContaining({
      description: expect.stringContaining('won "Item item1"'),
    }));
  });

  it("rolls back the optimistic update on a single failed sync", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: false, json: async () => ({ error: "quota exceeded" }) } as Response);
    const { result } = renderHook(() => useWinnersData("ss-id", [makeBidder()], [], "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(result.current.winners).toEqual({});
    expect(result.current.totalRaised).toBe(0);
    expect(toast.error).toHaveBeenCalledWith("Failed to sync updates. Your local change has been reverted.");
  });

  it("scopes a failed rollback to just the one item/amount - a second bid's already-committed change must survive", async () => {
    // Two bids recorded back-to-back, before either has re-rendered, both
    // capture the same pre-update baseline. If bid #2 fails, its rollback
    // must only undo bid #2 - not silently erase bid #1's already-
    // committed, successfully-synced change too.
    let resolveFirst: (v: any) => void;
    let resolveSecond: (v: any) => void;
    mockedFetchWithRetry
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    const bidders = [makeBidder({ id: "101", firstName: "Alice", lastName: "One" }), makeBidder({ id: "102", firstName: "Bob", lastName: "Two" })];
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, [], "Bid-Management", "Bidder-Numbers"));

    let firstCall: Promise<string>;
    let secondCall: Promise<string>;
    act(() => {
      firstCall = result.current.recordWinningBid("101", "item1", 50);
      secondCall = result.current.recordWinningBid("102", "item2", 75);
    });

    expect(result.current.winners).toEqual({ item1: "Alice One", item2: "Bob Two" });
    expect(result.current.totalRaised).toBe(125);

    // Bid #1 succeeds first.
    await act(async () => {
      resolveFirst!({ ok: true, json: async () => ({ success: true, followUpAdded: false }) });
      await firstCall;
    });

    // Bid #2 fails after bid #1 already committed.
    await act(async () => {
      resolveSecond!({ ok: false, json: async () => ({ error: "quota exceeded" }) });
      await secondCall;
    });

    // Bid #1's win must still be there - only bid #2's should be undone.
    expect(result.current.winners).toEqual({ item1: "Alice One" });
    expect(result.current.totalRaised).toBe(50);
  });
});

/**
 * Milestone A: a bid that can't reach the server is saved on the device
 * (src/lib/bidOutbox.ts) instead of being undone.
 */
describe("useWinnersData - saving bids that can't be sent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetOutboxForTesting();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  const bidders = [makeBidder({ id: "101", firstName: "Alice", lastName: "One" })];
  const items = [makeItem({ id: "item1", name: "Vintage Wine Basket" })];

  it("keeps the bid on screen and saves it, with the same key it was sent with, when the server can't be reached", async () => {
    mockedFetchWithRetry.mockRejectedValue(new (ServerUnreachableError as any)("Failed to fetch"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, items, "Bid-Management", "Bidder-Numbers", "items-id"));

    let key = "";
    await act(async () => {
      key = await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(result.current.winners).toEqual({ item1: "Alice One" });
    expect(toast.error).not.toHaveBeenCalled();
    const [entry] = getOutboxState().entries;
    expect(entry).toMatchObject({ status: "waiting", bidderName: "Alice One", itemName: "Vintage Wine Basket" });
    expect(entry.body.idempotencyKey).toBe(key);
    expect(JSON.parse((fetchWithRetry as any).mock.calls[0][1].body)).toEqual(entry.body);
    expect(entry.body.itemsSpreadsheetId).toBe("items-id");
  });

  it("saves it straight away, without trying, when the browser knows it's offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, items, "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(fetchWithRetry).not.toHaveBeenCalled();
    expect(getOutboxState().entries).toHaveLength(1);
    expect(result.current.totalRaised).toBe(50);
  });

  it("saves it and asks for a fresh sign-in when the session has expired (401)", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, items, "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(getOutboxState().entries).toHaveLength(1);
    expect(getOutboxState().needsSignIn).toBe(true);
    expect(result.current.winners).toEqual({ item1: "Alice One" });
  });

  it("still undoes a bid the server refuses (409), and saves nothing", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "already won" }) } as Response);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, items, "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(result.current.winners).toEqual({});
    expect(getOutboxState().entries).toEqual([]);
    expect(toast.error).toHaveBeenCalled();
  });

  it("counts saved bids as won after a reload, so the item can't be entered twice", async () => {
    addToOutbox({ bidderId: "101", itemId: "item9", price: 40, spreadsheetId: "ss-id", bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", idempotencyKey: "k" }, { bidderName: "Alice One", itemName: "Quilt" });
    addToOutbox({ bidderId: "101", itemId: "other", price: 99, spreadsheetId: "last-years-sheet", bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", idempotencyKey: "k2" }, { bidderName: "Alice One", itemName: "Old" });
    mockedGetSheetData.mockResolvedValue({ values: [BID_GRID_HEADER, ROW1, ROW2, ["item1", "$50.00", "", ""]] });
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, items, "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.fetchWinners();
    });

    expect(result.current.winners).toEqual({ item1: "Alice One", item9: "Alice One" });
    expect(result.current.totalRaised).toBe(90);
  });
});
