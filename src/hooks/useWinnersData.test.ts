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
 * flagged in refactor-opportunities.md: it used to restore the entire
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
import { Bidder } from "@/types";

vi.mock("@/services/google-api", () => ({
  getSheetData: vi.fn(),
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { getSheetData, fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";

const mockedGetSheetData = vi.mocked(getSheetData);
const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

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

    const { result } = renderHook(() => useWinnersData("ss-id", bidders, "Bid-Management", "Bidder-Numbers"));
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
    const { result } = renderHook(() => useWinnersData("ss-id", [makeBidder({ id: "999" })], "Bid-Management", "Bidder-Numbers"));
    await act(async () => {
      await result.current.fetchWinners();
    });

    expect(result.current.winners).toEqual({ item1: "Bidder 101" });
  });

  it("does nothing when spreadsheetId is empty", async () => {
    const { result } = renderHook(() => useWinnersData("", [makeBidder()], "Bid-Management", "Bidder-Numbers"));
    await act(async () => {
      await result.current.fetchWinners();
    });

    expect(getSheetData).not.toHaveBeenCalled();
  });

  it("does nothing when there are no bidders yet", async () => {
    const { result } = renderHook(() => useWinnersData("ss-id", [], "Bid-Management", "Bidder-Numbers"));
    await act(async () => {
      await result.current.fetchWinners();
    });

    expect(getSheetData).not.toHaveBeenCalled();
  });

  it("swallows a fetch failure without throwing or crashing", async () => {
    mockedGetSheetData.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useWinnersData("ss-id", [makeBidder()], "Bid-Management", "Bidder-Numbers"));

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
    const { result } = renderHook(() => useWinnersData("", [], "Bid-Management", "Bidder-Numbers"));

    await expect(result.current.recordWinningBid("101", "item1", 50)).rejects.toThrow("Spreadsheet ID not configured");
  });

  it("applies the optimistic update immediately, before the network call settles", async () => {
    let resolveFetch: (v: any) => void;
    mockedFetchWithRetry.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));
    const bidders = [makeBidder({ id: "101", firstName: "Alice", lastName: "One" })];
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, "Bid-Management", "Bidder-Numbers"));

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
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, "Bid-Management", "Bidder-Numbers"));

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

  it("shows the Follow-Up info toast when the bidder had already checked out", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({ success: true, followUpAdded: true }) } as Response);
    const { result } = renderHook(() => useWinnersData("ss-id", [makeBidder()], "Bid-Management", "Bidder-Numbers"));

    await act(async () => {
      await result.current.recordWinningBid("101", "item1", 50);
    });

    expect(toast.info).toHaveBeenCalledWith("Bidder was already checked out. Added to Follow-Up sheet.", { duration: 5000 });
  });

  it("rolls back the optimistic update on a single failed sync", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: false, json: async () => ({ error: "quota exceeded" }) } as Response);
    const { result } = renderHook(() => useWinnersData("ss-id", [makeBidder()], "Bid-Management", "Bidder-Numbers"));

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
    const { result } = renderHook(() => useWinnersData("ss-id", bidders, "Bid-Management", "Bidder-Numbers"));

    let firstCall: Promise<void>;
    let secondCall: Promise<void>;
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
