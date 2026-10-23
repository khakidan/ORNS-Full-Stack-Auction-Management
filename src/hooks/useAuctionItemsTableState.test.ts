/**
 * @vitest-environment jsdom
 *
 * useAuctionItemsTableState.ts was split (refactor-opportunities.md: it
 * was 437 lines, past this codebase's own "over 400 is almost certainly
 * doing too much" line) into five pieces - useAuctionItemsFilterSort.ts,
 * useAuctionItemUpdate.ts, useAuctionItemsBulkEdit.ts,
 * useAddAuctionItem.ts, useDeleteAuctionItem.ts - with this file left as
 * a thin composing container. AuctionItemsTab.test.tsx/
 * AuctionItemsTab.bundling.test.tsx already cover most of this hook's
 * surface through the real component, but neither exercises the
 * bulk-edit flow at all - confirmed by deliberately breaking the new
 * cross-hook wiring this split introduced (useAuctionItemsBulkEdit.ts
 * needs useAuctionItemsFilterSort.ts's `selectedRows`/`clearSelection`,
 * the same one-hook's-state-passed-into-another pattern
 * AuctionContext.tsx uses) and finding both existing component test
 * files still passed. This file closes that gap directly via
 * `renderHook`, scoped to proving the new wiring is real - not a full
 * hook test suite.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuctionItemsTableState } from "./useAuctionItemsTableState";
import { AuctionItem } from "@/types";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  updateSheetData: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  deleteAuctionItem: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { fetchWithRetry, updateSheetData } from "@/services/google-api";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

function makeItem(overrides: Partial<AuctionItem> = {}): AuctionItem {
  return {
    id: "101",
    name: "Art Class",
    category: "Food",
    description: "",
    value: "",
    openingBid: "",
    minRaise: "",
    donor: "",
    itemType: "",
    status: "Active",
    bundleId: "",
    bundledDateTime: "",
    rowIndex: 2,
    ...overrides,
  };
}

describe("useAuctionItemsTableState.executeBulkUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the real selected rows from filterSort and clears them via clearSelection on success", async () => {
    mockedFetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    const items = [makeItem({ id: "101", rowIndex: 2 }), makeItem({ id: "102", rowIndex: 3 })];
    const setItems = vi.fn();
    const fetchData = vi.fn();

    const { result } = renderHook(() =>
      useAuctionItemsTableState(items, setItems, "ss-id", [], fetchData)
    );

    act(() => {
      result.current.toggleRow(2);
      result.current.toggleRow(3);
    });
    expect(result.current.selectedItemsCount).toBe(2);

    act(() => {
      result.current.startBulkEdit("category", "Live");
    });

    await act(async () => {
      await result.current.executeBulkUpdate();
    });

    // The real selection (both rows) must have been sent, not an empty
    // or stale one - this is the wiring the split could have broken.
    const [url, init] = mockedFetchWithRetry.mock.calls[0];
    expect(url).toContain("/api/auction/bulk-update-items");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      spreadsheetId: "ss-id",
      rowIndices: [2, 3],
      field: "category",
      value: "Live",
      idempotencyKey: expect.any(String),
    });

    await waitFor(() => expect(result.current.selectedItemsCount).toBe(0));
    expect(result.current.isBulkEditing).toBe(false);
  });

  it("sends a bulk item-type change through the same locked bulk route, not direct cell writes", async () => {
    mockedFetchWithRetry.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    const items = [makeItem({ id: "101", rowIndex: 2 }), makeItem({ id: "102", rowIndex: 3 })];
    const { result } = renderHook(() =>
      useAuctionItemsTableState(items, vi.fn(), "ss-id", [], vi.fn())
    );

    act(() => {
      result.current.toggleRow(3);
      result.current.startBulkEdit("itemType", "Physical");
    });
    await act(async () => {
      await result.current.executeBulkUpdate();
    });

    const [url, init] = mockedFetchWithRetry.mock.calls[0];
    expect(url).toContain("/api/auction/bulk-update-items");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      rowIndices: [3],
      field: "itemType",
      value: "Physical",
    });
    expect(updateSheetData).not.toHaveBeenCalled();
  });
});
