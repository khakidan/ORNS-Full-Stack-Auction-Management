/**
 * @vitest-environment jsdom
 *
 * useCheckoutState is only ever consumed through Checkout.tsx, and
 * Checkout.test.tsx mocks useConfig/useAuction wholesale - so none of
 * this hook's real logic has ever run under the test suite. Scoped
 * narrowly to confirmMarkPaid's rollback behavior here (the same
 * whole-snapshot rollback bug already fixed in useWinnersData.ts,
 * useAttendeesData.ts, useAuctionItemsTableState.ts, and
 * useBiddersData.ts this session) - full hook coverage (loadWinners,
 * the receipt/email handlers, batch print/email) is a separate,
 * larger test-coverage gap, not part of this fix.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCheckoutState } from "./useCheckoutState";
import { Bidder, AuctionItem } from "@/types";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getSheetData: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { fetchWithRetry, getSheetData } from "@/services/google-api";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);
const mockedGetSheetData = vi.mocked(getSheetData);

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

const ITEM1: AuctionItem = { id: "item1", name: "Art Class", category: "", description: "", value: "", openingBid: "", minRaise: "", donor: "", itemType: "", status: "", bundleId: "", bundledDateTime: "", rowIndex: 2 };
const ITEM2: AuctionItem = { id: "item2", name: "Pizza Party", category: "", description: "", value: "", openingBid: "", minRaise: "", donor: "", itemType: "", status: "", bundleId: "", bundledDateTime: "", rowIndex: 3 };

// Column-pair bid grid: header holds bidder IDs in pairs, data starts row 3.
const BID_GRID_HEADER = ["101", "", "102", ""];
const ROW1 = ["Header", "Details", "Header", "Details"];
const ROW2 = ["More", "Stuff", "More", "Stuff"];

function mockLoadWinnersData() {
  mockedGetSheetData.mockImplementation((_id: string, range: string) => {
    if (range.startsWith("Special-Winners")) return Promise.resolve({ values: [] });
    if (range.includes("Bid-Management")) {
      return Promise.resolve({
        values: [BID_GRID_HEADER, ROW1, ROW2, ["item1", "$50.00", "item2", "$75.00"]],
      });
    }
    return Promise.resolve({ values: [] });
  });
}

const ITEMS = [ITEM1, ITEM2];

function renderWithTwoWinners() {
  const bidders = [makeBidder({ id: "101", firstName: "Alice", lastName: "One" }), makeBidder({ id: "102", firstName: "Bob", lastName: "Two" })];
  return renderHook(() =>
    useCheckoutState({
      bidders,
      items: ITEMS,
      attendees: [],
      fetchAllData: vi.fn(),
      spreadsheetId: "ss-id",
      ticketsSpreadsheetId: "",
      bidManagementSheet: "Bid-Management",
      bidderNumbersSheet: "Bidder-Numbers",
      folderId: "folder-id",
    })
  );
}

describe("useCheckoutState.confirmMarkPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadWinnersData();
  });

  it("rolls back the optimistic update on a single failed sync", async () => {
    mockedFetchWithRetry.mockResolvedValue({ ok: false, json: async () => ({ error: "sync failed" }) } as Response);

    const { result } = renderWithTwoWinners();
    await waitFor(() => expect(result.current.winners).toHaveLength(2));

    const alice = result.current.winners.find(w => w.bidderId === "101")!;
    act(() => {
      result.current.handleMarkPaid(alice);
      result.current.setPaymentMethod("Cash");
    });

    await act(async () => {
      await result.current.confirmMarkPaid();
    });

    await waitFor(() => {
      expect(result.current.winners.find(w => w.bidderId === "101")!.paid).toBe(false);
    });
  });

  it("scopes a failed rollback to just the one winner - a second winner's already-committed payment must survive", async () => {
    // Alice acts first (her rollback snapshot is captured before Bob has
    // acted at all) but her own sync is the one that ultimately fails.
    // Bob acts second and his sync succeeds and commits in the interim.
    // A whole-snapshot rollback on Alice's failure would restore her
    // stale pre-Bob snapshot and silently wipe Bob's already-committed
    // paid status - a scoped rollback must leave Bob untouched.
    let rejectFirst: (e: any) => void;
    let resolveSecond: (v: any) => void;
    mockedFetchWithRetry
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));

    const { result } = renderWithTwoWinners();
    await waitFor(() => expect(result.current.winners).toHaveLength(2));

    const alice = result.current.winners.find(w => w.bidderId === "101")!;
    const bob = result.current.winners.find(w => w.bidderId === "102")!;

    // Mark Alice paid (cash - fails via mock #1).
    act(() => {
      result.current.handleMarkPaid(alice);
      result.current.setPaymentMethod("Cash");
    });
    let aliceCall: Promise<void>;
    act(() => {
      aliceCall = result.current.confirmMarkPaid();
    });

    // Mark Bob paid (cash - succeeds via mock #2), while Alice's sync is
    // still in flight.
    act(() => {
      result.current.handleMarkPaid(bob);
      result.current.setPaymentMethod("Cash");
    });
    let bobCall: Promise<void>;
    act(() => {
      bobCall = result.current.confirmMarkPaid();
    });

    expect(result.current.winners.find(w => w.bidderId === "101")!.paid).toBe(true);
    expect(result.current.winners.find(w => w.bidderId === "102")!.paid).toBe(true);

    // Bob's sync succeeds and commits first.
    await act(async () => {
      resolveSecond!({ ok: true, json: async () => ({ success: true }) });
      await bobCall;
    });
    await waitFor(() => expect(result.current.winners.find(w => w.bidderId === "102")!.paid).toBe(true));

    // Alice's sync fails after Bob already committed - her rollback must
    // not touch Bob.
    await act(async () => {
      rejectFirst!(new Error("network down"));
      await aliceCall.catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.winners.find(w => w.bidderId === "101")!.paid).toBe(false);
    });
    expect(result.current.winners.find(w => w.bidderId === "102")!.paid).toBe(true);
  });
});
