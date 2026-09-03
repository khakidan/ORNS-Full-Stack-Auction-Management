/**
 * @vitest-environment jsdom
 *
 * useAuctionItems is only ever consumed through AuctionItemsTab.tsx, and
 * AuctionItemsTab.test.tsx mocks it wholesale via vi.mock() - so none of
 * its real logic has ever run under the test suite. Tested directly via
 * renderHook, matching the pattern already established for
 * useBiddersData.ts/useBundling.ts.
 *
 * This is also the exact hook whose hand-rolled item parser was just
 * replaced with the shared parseItemRows() (previously drifted: a
 * different status default and a stricter id-AND-name filter than every
 * other screen in the app uses) - these tests pin the now-shared, correct
 * behavior.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuctionItems } from "./useAuctionItems";

vi.mock("@/services/google-api", () => ({
  getSheetData: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

import { getSheetData } from "@/services/google-api";
import { toast } from "sonner";

const mockedGetSheetData = vi.mocked(getSheetData);

const ITEMS_HEADER = ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical/Cert", "Status", "Bundle ID", "Bundled Date/Time"];

function mockRoutedData(overrides: Record<string, any> = {}) {
  mockedGetSheetData.mockImplementation((_spreadsheetId: string, range: string) => {
    if (range.startsWith("Auction-Items")) {
      return Promise.resolve(overrides.items ?? { values: [ITEMS_HEADER, ["801", "Food", "Pizza Night", "desc", "$50", "$22.50", "$5", "Joe's Pizza", "Certificate", "Active", "", ""]] });
    }
    if (range.startsWith("Categories")) {
      return Promise.resolve(overrides.categories ?? { values: [["Category", "Base"], ["Food", "800"]] });
    }
    if (range.startsWith("Value Calculations")) {
      return Promise.resolve(overrides.valueCalculations ?? { values: [["Min Range", "Min Raise"], ["0", "5"]] });
    }
    return Promise.resolve({ values: [] });
  });
}

describe("useAuctionItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches items/categories/valueCalculations in parallel on mount and clears loading", async () => {
    mockRoutedData();
    const { result } = renderHook(() => useAuctionItems("ss-id"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].name).toBe("Pizza Night");
    expect(result.current.categories).toEqual(["Food"]);
    expect(result.current.categoriesWithBase).toEqual([{ name: "Food", base: 800 }]);
    expect(result.current.valueCalculations).toEqual([{ minRange: 0, minRaise: 5 }]);
  });

  it("parses items via the shared parseItemRows semantics: defaults blank status to Active, and includes a row with only an id or only a name", async () => {
    mockRoutedData({
      items: {
        values: [
          ITEMS_HEADER,
          ["801", "Food", "Pizza Night", "desc", "$50", "$22.50", "$5", "Joe's Pizza", "Certificate", "", "", ""], // blank status
          ["802", "Food", "", "desc", "$10", "", "", "", "", "Active", "", ""], // id but no name
        ],
      },
    });
    const { result } = renderHook(() => useAuctionItems("ss-id"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].status).toBe("Active"); // blank status defaults to Active, not ""
    expect(result.current.items[1].id).toBe("802"); // id-only row is included, not dropped
  });

  it("does nothing and clears loading when spreadsheetId is empty", async () => {
    const { result } = renderHook(() => useAuctionItems(""));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getSheetData).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it("shows an error toast (not a crash) when fetching items fails", async () => {
    mockedGetSheetData.mockImplementation((_spreadsheetId: string, range: string) => {
      if (range.startsWith("Auction-Items")) return Promise.reject(new Error("network down"));
      return Promise.resolve({ values: [] });
    });
    const { result } = renderHook(() => useAuctionItems("ss-id"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(toast.error).toHaveBeenCalledWith("Failed to load auction items");
    expect(result.current.items).toEqual([]);
  });

  it("swallows a failed categories/valueCalculations fetch without crashing (items still load)", async () => {
    mockedGetSheetData.mockImplementation((_spreadsheetId: string, range: string) => {
      if (range.startsWith("Auction-Items")) {
        return Promise.resolve({ values: [ITEMS_HEADER, ["801", "Food", "Pizza Night", "desc", "$50", "$22.50", "$5", "Joe's Pizza", "Certificate", "Active", "", ""]] });
      }
      return Promise.reject(new Error("network down"));
    });
    const { result } = renderHook(() => useAuctionItems("ss-id"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.categories).toEqual([]);
    expect(result.current.valueCalculations).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("refresh() re-fetches all three and toggles loading again", async () => {
    mockRoutedData();
    const { result } = renderHook(() => useAuctionItems("ss-id"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedGetSheetData.mockClear();
    await act(async () => {
      await result.current.refresh();
    });

    expect(getSheetData).toHaveBeenCalledTimes(3);
    expect(result.current.loading).toBe(false);
  });
});
