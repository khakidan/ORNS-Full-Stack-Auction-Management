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
  updateSheetData: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { getSheetData, updateSheetData } from "@/services/google-api";
import { toast } from "sonner";

const mockedGetSheetData = vi.mocked(getSheetData);
const mockedUpdateSheetData = vi.mocked(updateSheetData);

const SPREADSHEET_ID = "test-spreadsheet-id";
const SHEET_NAME = "Bidder-Numbers";

const bidder101 = {
  id: "101",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@example.com",
  checkedIn: false,
  isProxy: false,
  checkedOut: false,
  paid: false,
  rowIndex: 2,
};

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

  describe("checkInBidder", () => {
    it("applies the optimistic update immediately, then writes column E at the bidder's real sheet row", async () => {
      // A:A lookup: header row + one data row for bidder 101 at array index 1 -> sheet row 2.
      mockedGetSheetData.mockResolvedValue({ values: [["ID"], ["101"]] } as any);
      mockedUpdateSheetData.mockResolvedValue({} as any);

      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));

      // Seed state the same way fetchBidders would, without depending on it.
      await act(async () => {
        mockedGetSheetData.mockResolvedValueOnce({
          values: [["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"], ["101", "Jane", "Doe", "jane@example.com", "FALSE", "FALSE", "FALSE", "FALSE"]],
        } as any);
        await result.current.fetchBidders();
      });

      await act(async () => {
        await result.current.checkInBidder(result.current.bidders[0]);
      });

      // Optimistic update landed.
      expect(result.current.bidders[0].checkedIn).toBe(true);

      await waitFor(() => {
        expect(updateSheetData).toHaveBeenCalledWith(SPREADSHEET_ID, `${SHEET_NAME}!E2`, [[true]]);
      });
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Jane Doe checked in (Synced)");
      });
    });

    it("rolls back the optimistic update and shows an error toast when the bidder isn't found in the sheet", async () => {
      // A:A lookup returns only the header row - bidder 101 is nowhere in it.
      mockedGetSheetData.mockResolvedValue({ values: [["ID"]] } as any);

      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));

      await act(async () => {
        mockedGetSheetData.mockResolvedValueOnce({
          values: [["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"], ["101", "Jane", "Doe", "jane@example.com", "FALSE", "FALSE", "FALSE", "FALSE"]],
        } as any);
        await result.current.fetchBidders();
      });

      await act(async () => {
        await result.current.checkInBidder(result.current.bidders[0]);
      });

      // Rolled back once the background sync discovers the row is missing
      // (the optimistic update landed first internally - see the happy-path
      // test above - but with mocks resolving on immediate microtasks, the
      // rollback can complete before this assertion runs, so only the
      // settled end state is asserted here).
      await waitFor(() => {
        expect(result.current.bidders[0].checkedIn).toBe(false);
      });
      expect(updateSheetData).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("Failed to sync updates. Your local change has been reverted.");
    });

    it("rolls back when the sheet write itself fails", async () => {
      mockedGetSheetData.mockResolvedValue({ values: [["ID"], ["101"]] } as any);
      mockedUpdateSheetData.mockRejectedValue(new Error("API quota exceeded"));

      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));

      await act(async () => {
        mockedGetSheetData.mockResolvedValueOnce({
          values: [["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"], ["101", "Jane", "Doe", "jane@example.com", "FALSE", "FALSE", "FALSE", "FALSE"]],
        } as any);
        await result.current.fetchBidders();
      });

      await act(async () => {
        await result.current.checkInBidder(result.current.bidders[0]);
      });

      await waitFor(() => {
        expect(result.current.bidders[0].checkedIn).toBe(false);
      });
      expect(toast.error).toHaveBeenCalled();
    });

    it("scopes a failed rollback to just the one bidder - a second bidder's already-committed check-in must survive", async () => {
      mockedGetSheetData.mockResolvedValueOnce({
        values: [
          ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"],
          ["101", "Jane", "Doe", "jane@example.com", "FALSE", "FALSE", "FALSE", "FALSE"],
          ["102", "John", "Smith", "john@example.com", "FALSE", "FALSE", "FALSE", "FALSE"],
        ],
      } as any);

      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));
      await act(async () => {
        await result.current.fetchBidders();
      });

      const bidder101 = result.current.bidders.find(b => b.id === "101")!;
      const bidder102 = result.current.bidders.find(b => b.id === "102")!;

      // A:A lookup for bidder 101 (found at row 2), then for bidder 102
      // (not found - only the header + 101's row present).
      mockedGetSheetData
        .mockResolvedValueOnce({ values: [["ID"], ["101"]] } as any)
        .mockResolvedValueOnce({ values: [["ID"], ["101"]] } as any);

      let resolveUpdate: (v: any) => void;
      mockedUpdateSheetData.mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve; }));

      act(() => {
        result.current.checkInBidder(bidder101);
        result.current.checkInBidder(bidder102);
      });

      expect(result.current.bidders.find(b => b.id === "101")!.checkedIn).toBe(true);
      expect(result.current.bidders.find(b => b.id === "102")!.checkedIn).toBe(true);

      // Bidder 101's write succeeds and commits.
      await act(async () => {
        resolveUpdate!(undefined);
      });
      await waitFor(() => expect(result.current.bidders.find(b => b.id === "101")!.checkedIn).toBe(true));

      // Bidder 102's row lookup fails (not found) after 101 already
      // committed - its rollback must not touch 101.
      await waitFor(() => {
        expect(result.current.bidders.find(b => b.id === "102")!.checkedIn).toBe(false);
      });
      expect(result.current.bidders.find(b => b.id === "101")!.checkedIn).toBe(true);
    });
  });

  describe("markBidderAsProxy", () => {
    it("applies the optimistic update immediately, then writes column F at the bidder's real sheet row", async () => {
      mockedUpdateSheetData.mockResolvedValue({} as any);

      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));

      await act(async () => {
        mockedGetSheetData.mockResolvedValueOnce({
          values: [["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"], ["101", "Jane", "Doe", "jane@example.com", "TRUE", "FALSE", "FALSE", "FALSE"]],
        } as any);
        await result.current.fetchBidders();
      });

      mockedGetSheetData.mockResolvedValueOnce({ values: [["ID"], ["101"]] } as any);

      await act(async () => {
        await result.current.markBidderAsProxy(result.current.bidders[0]);
      });

      expect(result.current.bidders[0].isProxy).toBe(true);

      await waitFor(() => {
        expect(updateSheetData).toHaveBeenCalledWith(SPREADSHEET_ID, `${SHEET_NAME}!F2`, [[true]]);
      });
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Jane Doe marked as Proxy Bidder");
      });
    });

    it("rolls back on failure and leaves other bidders' state untouched", async () => {
      mockedUpdateSheetData.mockRejectedValue(new Error("network error"));

      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));

      await act(async () => {
        mockedGetSheetData.mockResolvedValueOnce({
          values: [
            ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"],
            ["101", "Jane", "Doe", "jane@example.com", "TRUE", "FALSE", "FALSE", "FALSE"],
            ["102", "John", "Smith", "john@example.com", "TRUE", "TRUE", "FALSE", "FALSE"],
          ],
        } as any);
        await result.current.fetchBidders();
      });

      mockedGetSheetData.mockResolvedValueOnce({ values: [["ID"], ["101"], ["102"]] } as any);

      const target = result.current.bidders.find(b => b.id === "101")!;
      await act(async () => {
        await result.current.markBidderAsProxy(target);
      });

      await waitFor(() => {
        expect(result.current.bidders.find(b => b.id === "101")!.isProxy).toBe(false);
      });
      // Bidder 102's pre-existing isProxy: true survives the rollback unchanged.
      expect(result.current.bidders.find(b => b.id === "102")!.isProxy).toBe(true);
    });

    it("scopes a failed rollback to just the one bidder - a second bidder's already-committed proxy mark must survive", async () => {
      const { result } = renderHook(() => useBiddersData(SPREADSHEET_ID, SHEET_NAME));
      await act(async () => {
        mockedGetSheetData.mockResolvedValueOnce({
          values: [
            ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid"],
            ["101", "Jane", "Doe", "jane@example.com", "FALSE", "FALSE", "FALSE", "FALSE"],
            ["102", "John", "Smith", "john@example.com", "FALSE", "FALSE", "FALSE", "FALSE"],
          ],
        } as any);
        await result.current.fetchBidders();
      });

      const bidder101 = result.current.bidders.find(b => b.id === "101")!;
      const bidder102 = result.current.bidders.find(b => b.id === "102")!;

      // A:A lookup for 101 (found), then for 102 (sheet only has 101's row).
      mockedGetSheetData
        .mockResolvedValueOnce({ values: [["ID"], ["101"]] } as any)
        .mockResolvedValueOnce({ values: [["ID"], ["101"]] } as any);

      let resolveUpdate: (v: any) => void;
      mockedUpdateSheetData.mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve; }));

      act(() => {
        result.current.markBidderAsProxy(bidder101);
        result.current.markBidderAsProxy(bidder102);
      });

      await act(async () => {
        resolveUpdate!(undefined);
      });
      await waitFor(() => expect(result.current.bidders.find(b => b.id === "101")!.isProxy).toBe(true));

      await waitFor(() => {
        expect(result.current.bidders.find(b => b.id === "102")!.isProxy).toBe(false);
      });
      expect(result.current.bidders.find(b => b.id === "101")!.isProxy).toBe(true);
    });
  });
});
