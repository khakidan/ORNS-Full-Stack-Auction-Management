/**
 * @vitest-environment jsdom
 *
 * AuctionItemsTab.test.tsx never exercises single-item editing (its
 * suite is filter/search/sort only) and leaves @/services/google-api
 * unmocked, since it never needed to touch the network. This file tests
 * the real wiring between AuctionItemRow.tsx's Edit button,
 * EditAuctionItemDialog.tsx, and useAuctionItemUpdate.ts's real
 * `handleUpdate` - mirroring AuctionItemsTab.bundling.test.tsx's
 * convention of mocking google-api and leaving the hook under test real.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuctionItemsTab from "./AuctionItemsTab";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)} data-testid="mock-select">
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <option value="" disabled>{placeholder}</option>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({ config: { auctionItemsSpreadsheetId: "test-sheet-id" } })
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({ isAuctionClosed: false })
}));

vi.mock("@/hooks/useAuctionItems", () => ({
  useAuctionItems: () => ({
    items: [
      { id: "101", rowIndex: 2, name: "Food 1", description: "Desc 1", category: "Food", value: "$100.00", openingBid: "$45.00", minRaise: "$5.00", donor: "Donor A", itemType: "Certificate", status: "Active", bundleId: "", bundledDateTime: "" },
    ],
    setItems: vi.fn(),
    categories: ["Food", "Health & Beauty"],
    valueCalculations: [],
    loading: false,
    refresh: vi.fn()
  })
}));

vi.mock("@/hooks/useBundling", () => ({
  useBundling: () => ({
    isBundling: false,
    setIsBundling: vi.fn(),
    bundleDetails: { category: "", startingBid: "", name: "", type: "", donor: "" },
    setBundleDetails: vi.fn(),
    aiSuggestions: [],
    loadingSuggestions: false,
    loadingDescription: false,
    isExecutingBundle: false,
    restoreBundleId: null,
    isExecutingRestore: false,
    openBundlingModal: vi.fn(),
    getAiSuggestions: vi.fn(),
    getAiDescriptionSuggestion: vi.fn(),
    executeBundle: vi.fn(),
    handleRestoreBundle: vi.fn()
  })
}));

// google-api intentionally NOT mocked wholesale as no-ops - this file
// tests the real handleUpdate wiring, matching
// AuctionItemsTab.bundling.test.tsx's convention for useBundling.
vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  updateSheetData: vi.fn().mockResolvedValue({}),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  deleteAuctionItem: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { updateSheetData, fetchWithRetry } from "@/services/google-api";

const mockedUpdateSheetData = vi.mocked(updateSheetData);
const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

describe("AuctionItemsTab - real single-item edit wiring", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    mockedUpdateSheetData.mockResolvedValue({});
    user = userEvent.setup();
  });

  it("clicking Edit opens the dialog prefilled with the real item's fields", async () => {
    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByDisplayValue("Food 1")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Donor A")).toBeInTheDocument();
  });

  it("saving a changed non-category field writes directly to the sheet, not through the resequencing endpoint", async () => {
    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    const donorInput = within(dialog).getByDisplayValue("Donor A");
    await user.clear(donorInput);
    await user.type(donorInput, "Donor Z");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(mockedUpdateSheetData).toHaveBeenCalledWith("test-sheet-id", "Auction-Items!H2", [["Donor Z"]]);
    expect(mockedFetchWithRetry).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saving a changed category goes through the resequencing endpoint instead of a direct cell write", async () => {
    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    const categorySelect = within(dialog).getAllByTestId("mock-select")[0];
    await user.selectOptions(categorySelect, "Health & Beauty");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(mockedFetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/api/auction/update-item"),
      expect.objectContaining({
        body: JSON.stringify({
          spreadsheetId: "test-sheet-id",
          rowIndex: 2,
          field: "category",
          value: "Health & Beauty",
        }),
      })
    );
  });

  // Regression guard: category's resequencing + full resync
  // (useAuctionItemUpdate.ts's fetchData()) must not fire until every
  // other changed field's own write has at least been dispatched - firing
  // it concurrently risks the resync clobbering another field's
  // just-issued optimistic update before it's persisted. This is a real
  // scenario now that one dialog Save can change multiple fields at once
  // (previously each field committed via its own separate inline edit).
  it("dispatches the non-category field write before starting the category resequencing call, when both change in one Save", async () => {
    const callOrder: string[] = [];
    mockedUpdateSheetData.mockImplementation(async () => {
      callOrder.push("donor-write");
      return {};
    });
    mockedFetchWithRetry.mockImplementation(async () => {
      callOrder.push("category-resequence");
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    const donorInput = within(dialog).getByDisplayValue("Donor A");
    await user.clear(donorInput);
    await user.type(donorInput, "Donor Z");
    const categorySelect = within(dialog).getAllByTestId("mock-select")[0];
    await user.selectOptions(categorySelect, "Health & Beauty");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(callOrder).toEqual(["donor-write", "category-resequence"]);
  });
});
