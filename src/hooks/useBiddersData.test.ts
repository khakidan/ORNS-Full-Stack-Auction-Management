/**
 * @vitest-environment jsdom
 *
 * The real check-in/proxy optimistic-update-with-rollback logic in this
 * hook is only ever exercised through AuctionContext.tsx, and every
 * component test mocks that context wholesale via vi.mock() - so none of
 * this logic has ever actually run under the test suite. Tested directly
 * via renderHook (the first use of it in this codebase - existing
 * convention is integration-style component tests, but there's no
 * component test path that reaches this hook's real code).
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useBiddersData } from "./useBiddersData";

vi.mock("@/services/google-api", () => ({
  getSheetData: vi.fn(),
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => ""),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { getSheetData, fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";

const mockedGetSheetData = vi.mocked(getSheetData);
const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

const ok = () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) as Response;
const refused = (error: string) => ({ ok: false, status: 400, json: async () => ({ error }) }) as Response;

/** The JSON body of the n-th /api/bidders/set-flag request. */
const setFlagBody = (n = 0) => {
  const calls = mockedFetchWithRetry.mock.calls.filter(([url]) => String(url).includes("/api/bidders/set-flag"));
  return JSON.parse(String((calls[n][1] as RequestInit).body));
};

const TWO_BIDDERS = {
  values: [
    ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"],
    ["101", "Jane", "Doe", "jane@example.com", "FALSE", "FALSE", "FALSE", "FALSE"],
    ["102", "John", "Smith", "john@example.com", "FALSE", "TRUE", "FALSE", "FALSE"],
  ],
};

const SPREADSHEET_ID = "test-spreadsheet-id";
const SHEET_NAME = "Bidder-Numbers";

describe("useBiddersData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchBidders", () => {
    it("parses sheet rows into bidders on success", async () => {
      mockedGetSheetData.mockResolvedValue({
        values: [
          ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"],
          ["101", "Jane", "Doe", "jane@example.com", "TRUE", "FALSE", "FALSE", "FALSE"],
        ],
      } as any);

      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));

      await act(async () => {
        await result.current.fetchBidders();
      });

      expect(result.current.bidders).toHaveLength(1);
      expect(result.current.bidders[0]).toMatchObject({ id: "101", firstName: "Jane", checkedIn: true });
      expect(getSheetData).toHaveBeenCalledWith(SPREADSHEET_ID, `${SHEET_NAME}!A:L`);
    });

    it("sets an empty list (not a thrown error) when the fetch fails", async () => {
      mockedGetSheetData.mockRejectedValue(new Error("network down"));

      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));

      await act(async () => {
        await result.current.fetchBidders();
      });

      expect(result.current.bidders).toEqual([]);
    });
  });

  async function renderWithBidders() {
    mockedGetSheetData.mockResolvedValueOnce(TWO_BIDDERS as any);
    const hook = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));
    await act(async () => {
      await hook.result.current.fetchBidders();
    });
    return hook;
  }
  const find = (result: { current: ReturnType<typeof useBiddersData> }, id: string) =>
    result.current.bidders.find(b => b.id === id)!;

  describe("checkInBidder", () => {
    it("ticks the box at once, then asks the server's locked set-flag route to save it", async () => {
      mockedFetchWithRetry.mockResolvedValue(ok());
      const { result } = await renderWithBidders();

      await act(async () => {
        await result.current.checkInBidder(find(result, "101"));
      });

      expect(find(result, "101").checkedIn).toBe(true);
      expect(setFlagBody()).toEqual({
        spreadsheetId: SPREADSHEET_ID,
        bidderNumbersSheet: SHEET_NAME,
        bidderId: "101",
        flag: "checkedIn",
      });
      expect(toast.success).toHaveBeenCalledWith("Jane Doe checked in (Synced)");
    });

    it("unticks the box and shows an error when the server refuses (e.g. bidder not in the sheet)", async () => {
      mockedFetchWithRetry.mockResolvedValue(refused("Bidder 101 not found in Bidder-Numbers"));
      const { result } = await renderWithBidders();

      await act(async () => {
        await result.current.checkInBidder(find(result, "101"));
      });

      expect(find(result, "101").checkedIn).toBe(false);
      expect(toast.error).toHaveBeenCalledWith("Failed to sync updates. Your local change has been reverted.");
    });

    it("unticks the box when the server can't be reached", async () => {
      mockedFetchWithRetry.mockRejectedValue(new Error("network down"));
      const { result } = await renderWithBidders();

      await act(async () => {
        await result.current.checkInBidder(find(result, "101"));
      });

      expect(find(result, "101").checkedIn).toBe(false);
      expect(toast.error).toHaveBeenCalled();
    });

    it("rolls back only the bidder whose save failed - another bidder's saved check-in survives", async () => {
      const { result } = await renderWithBidders();
      let resolveFirst: (r: Response) => void;
      mockedFetchWithRetry
        .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValueOnce(refused("Bidder 102 not found in Bidder-Numbers"));

      act(() => {
        result.current.checkInBidder(find(result, "101"));
        result.current.checkInBidder(find(result, "102"));
      });
      expect(find(result, "101").checkedIn).toBe(true);
      expect(find(result, "102").checkedIn).toBe(true);

      await waitFor(() => expect(find(result, "102").checkedIn).toBe(false));
      await act(async () => {
        resolveFirst!(ok());
      });
      expect(find(result, "101").checkedIn).toBe(true);
    });
  });

  describe("markBidderAsProxy", () => {
    it("ticks the box at once, then asks the server to save the proxy flag", async () => {
      mockedFetchWithRetry.mockResolvedValue(ok());
      const { result } = await renderWithBidders();

      await act(async () => {
        await result.current.markBidderAsProxy(find(result, "101"));
      });

      expect(find(result, "101").isProxy).toBe(true);
      expect(setFlagBody()).toMatchObject({ bidderId: "101", flag: "isProxy" });
      expect(toast.success).toHaveBeenCalledWith("Jane Doe marked as Proxy Bidder");
    });

    it("rolls back on failure and leaves other bidders' state untouched", async () => {
      mockedFetchWithRetry.mockRejectedValue(new Error("network error"));
      const { result } = await renderWithBidders();

      await act(async () => {
        await result.current.markBidderAsProxy(find(result, "101"));
      });

      expect(find(result, "101").isProxy).toBe(false);
      // Bidder 102's existing isProxy: true is untouched.
      expect(find(result, "102").isProxy).toBe(true);
    });
  });
});
