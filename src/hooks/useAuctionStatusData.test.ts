/**
 * @vitest-environment jsdom
 *
 * useAuctionStatusData is only ever consumed through AuctionContext.tsx,
 * which every component test mocks wholesale via vi.mock() - so there's
 * no component-test path that reaches this hook's real code. Tested
 * directly via renderHook, matching the pattern already established for
 * useBiddersData.ts.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuctionStatusData } from "./useAuctionStatusData";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  getSheetData: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { fetchWithRetry, getSheetData } from "@/services/google-api";
import { toast } from "sonner";

const mockedGetSheetData = vi.mocked(getSheetData);
const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

const SPREADSHEET_ID = "test-spreadsheet-id";
const BID_MGMT_SHEET = "Bid-Management";
const BIDDER_NUMBERS_SHEET = "Bidder-Numbers";

describe("useAuctionStatusData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchAuctionStatus", () => {
    it.each([
      ["the boolean false", false, true],
      ['the string "FALSE"', "FALSE", true],
      ["the boolean true", true, false],
      ['the string "TRUE"', "TRUE", false],
      ['the lowercase string "false"', "false", true],
      ['"Closed"', "Closed", true],
      ['"Prep"', "Prep", false],
      ['"Live"', "Live", false],
    ])("treats %s as %s for isAuctionClosed", async (_label, cellValue, expectedClosed) => {
      mockedGetSheetData.mockResolvedValue({ values: [[cellValue]] } as any);

      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      await act(async () => {
        await result.current.fetchAuctionStatus();
      });

      expect(result.current.isAuctionClosed).toBe(expectedClosed);
    });

    it.each([
      [true, "prep"], ["TRUE", "prep"], ["Prep", "prep"], ["Live", "live"], [false, "closed"], ["Closed", "closed"],
    ])("reads the cell %s as the %s state, so a sheet from before the three states still works", async (cellValue, expectedState) => {
      mockedGetSheetData.mockResolvedValue({ values: [[cellValue]] } as any);

      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      await act(async () => {
        await result.current.fetchAuctionStatus();
      });

      expect(result.current.auctionState).toBe(expectedState);
    });

    it("does nothing when spreadsheetId is empty", async () => {
      const { result } = renderHook(() => useAuctionStatusData("", BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      await act(async () => {
        await result.current.fetchAuctionStatus();
      });

      expect(getSheetData).not.toHaveBeenCalled();
      expect(result.current.isAuctionClosed).toBe(false);
    });

    it("leaves isAuctionClosed unchanged and doesn't throw when the fetch fails", async () => {
      mockedGetSheetData.mockRejectedValue(new Error("network down"));

      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      await act(async () => {
        await result.current.fetchAuctionStatus();
      });

      expect(result.current.isAuctionClosed).toBe(false);
    });

    it("leaves isAuctionClosed unchanged when the sheet returns no values", async () => {
      mockedGetSheetData.mockResolvedValue({ values: [] } as any);

      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      await act(async () => {
        await result.current.fetchAuctionStatus();
      });

      expect(result.current.isAuctionClosed).toBe(false);
    });
  });

  describe("requestCloseAuction", () => {
    it("closes the auction, sets isAuctionClosed, and toasts success", async () => {
      mockedFetchWithRetry.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, count: 0 }),
      } as Response);

      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.requestCloseAuction();
      });

      expect(returned).toBe(true);
      expect(result.current.isAuctionClosed).toBe(true);
      expect(fetchWithRetry).toHaveBeenCalledWith(
        "http://localhost:3000/api/auction/close-and-cleanup",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            spreadsheetId: SPREADSHEET_ID,
            bidderNumbersSheet: BIDDER_NUMBERS_SHEET,
            bidManagementSheet: BID_MGMT_SHEET,
          }),
        })
      );
      expect(toast.success).toHaveBeenCalledWith("Auction closed successfully.");
      expect(toast.info).not.toHaveBeenCalled();
    });

    it("also shows an info toast when non-winning bidders were auto-checked-out", async () => {
      mockedFetchWithRetry.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, count: 3 }),
      } as Response);

      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      await act(async () => {
        await result.current.requestCloseAuction();
      });

      expect(toast.info).toHaveBeenCalledWith("Automatically checked out 3 non-winning bidders.");
    });

    it("returns false, toasts the server error, and leaves isAuctionClosed false when the request fails", async () => {
      mockedFetchWithRetry.mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Missing required spreadsheet parameters for cleanup." }),
      } as Response);

      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.requestCloseAuction();
      });

      expect(returned).toBe(false);
      expect(result.current.isAuctionClosed).toBe(false);
      expect(toast.error).toHaveBeenCalledWith("Failed to close auction: Missing required spreadsheet parameters for cleanup.");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("returns false and toasts an error when the network request itself throws", async () => {
      mockedFetchWithRetry.mockRejectedValue(new Error("Failed to fetch"));

      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.requestCloseAuction();
      });

      expect(returned).toBe(false);
      expect(result.current.isAuctionClosed).toBe(false);
      expect(toast.error).toHaveBeenCalledWith("Failed to close auction: Failed to fetch");
    });

    it("does nothing and returns false when spreadsheetId is empty", async () => {
      const { result } = renderHook(() => useAuctionStatusData("", BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.requestCloseAuction();
      });

      expect(returned).toBe(false);
      expect(fetchWithRetry).not.toHaveBeenCalled();
    });
  });

  describe("requestGoLive", () => {
    it("posts to go-live and moves to the Live state", async () => {
      mockedFetchWithRetry.mockResolvedValue({ ok: true, status: 200, json: async () => ({ state: "live" }) } as any);
      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      let ok = false;
      await act(async () => { ok = await result.current.requestGoLive(); });

      expect(ok).toBe(true);
      expect(mockedFetchWithRetry).toHaveBeenCalledWith(expect.stringContaining("/api/auction/go-live"), expect.objectContaining({ method: "POST" }));
      expect(result.current.auctionState).toBe("live");
      expect(result.current.isAuctionClosed).toBe(false);
    });

    it("stays in Prep and reports the reason when the server refuses (for example it was already Closed)", async () => {
      mockedFetchWithRetry.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "The auction is already Closed; it can only go Live from Prep." }) } as any);
      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      let ok = true;
      await act(async () => { ok = await result.current.requestGoLive(); });

      expect(ok).toBe(false);
      expect(result.current.auctionState).toBe("prep");
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("already Closed"));
    });
  });

  describe("fetchSetupStatus", () => {
    it.each([[true], [false]])("reports setUp=%s from the server", async (setUp) => {
      mockedFetchWithRetry.mockResolvedValue({ ok: true, status: 200, json: async () => ({ setUp }) } as any);
      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));
      expect(result.current.isBidManagementSetUp).toBeNull();

      await act(async () => { await result.current.fetchSetupStatus(); });

      expect(mockedFetchWithRetry).toHaveBeenCalledWith(expect.stringContaining(`setup-status?spreadsheetId=${SPREADSHEET_ID}`), expect.anything());
      expect(result.current.isBidManagementSetUp).toBe(setUp);
    });

    it("stays unknown (null), so the header offers neither Set Up nor Go Live, when the check fails", async () => {
      mockedFetchWithRetry.mockRejectedValue(new Error("network down"));
      const { result } = renderHook(() => useAuctionStatusData(SPREADSHEET_ID, BID_MGMT_SHEET, BIDDER_NUMBERS_SHEET));

      await act(async () => { await result.current.fetchSetupStatus(); });

      expect(result.current.isBidManagementSetUp).toBeNull();
    });
  });
});
