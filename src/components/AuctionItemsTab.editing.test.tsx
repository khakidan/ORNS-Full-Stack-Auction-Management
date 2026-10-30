/**
 * @vitest-environment jsdom
 *
 * AuctionItemsTab.test.tsx never exercises single-item editing (its
 * suite is filter/search/sort only) and leaves @/services/google-api
 * unmocked, since it never needed to touch the network. This file tests
 * the real wiring between AuctionItemRow.tsx's Edit button,
 * EditAuctionItemDialog.tsx, and useAuctionItemUpdate.ts's real
 * `saveItemChanges` - mirroring AuctionItemsTab.bundling.test.tsx's
 * convention of mocking google-api and leaving the hook under test real.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuctionItemsTab from "./AuctionItemsTab";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({ config: { auctionItemsSpreadsheetId: "test-sheet-id" } })
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({ isAuctionClosed: false })
}));

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("@/hooks/useAuctionItems", () => ({
  useAuctionItems: () => ({
    items: [
      { id: "101", rowIndex: 2, name: "Food 1", description: "Desc 1", category: "Food", value: "$100.00", openingBid: "$45.00", minRaise: "$5.00", donor: "Donor A", itemType: "Certificate", status: "Active", bundleId: "", bundledDateTime: "" },
    ],
    setItems: vi.fn(),
    categories: ["Food", "Health & Beauty"],
    valueCalculations: [],
    loading: false,
    refresh: mockRefresh
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
// tests the real saveItemChanges wiring, matching
// AuctionItemsTab.bundling.test.tsx's convention for useBundling.
vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  deleteAuctionItem: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { fetchWithRetry } from "@/services/google-api";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

describe("AuctionItemsTab - real single-item edit wiring", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchWithRetry.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
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

  const updateItemBody = () => {
    const call = mockedFetchWithRetry.mock.calls.find(([url]) => String(url).includes("/api/auction/update-item"));
    return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
  };

  it("saving a changed field sends it to the locked update-item route, never a direct cell write", async () => {
    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    const donorInput = within(dialog).getByDisplayValue("Donor A");
    await user.clear(donorInput);
    await user.type(donorInput, "Donor Z");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(updateItemBody()).toEqual({
      spreadsheetId: "test-sheet-id",
      rowIndex: 2,
      changes: { donor: "Donor Z" },
      expectedName: "Food 1",
    });
    expect(mockedFetchWithRetry.mock.calls.some(([url]) => String(url).includes("/api/sheets/"))).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends a category change and another field together in one request", async () => {
    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    const donorInput = within(dialog).getByDisplayValue("Donor A");
    await user.clear(donorInput);
    await user.type(donorInput, "Donor Z");
    await user.click(within(dialog).getByRole("combobox", { name: "Category" }));
    await user.click(await screen.findByRole("option", { name: "Health & Beauty" }));
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1);
    expect(updateItemBody().changes).toEqual({ category: "Health & Beauty", donor: "Donor Z" });
  });

  // Bug report "Item's value change doesn't update min bid and starting
  // value": a new value with the two amounts cleared saved them blank.
  it("fills a cleared opening bid and min raise from the new value", async () => {
    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    const valueInput = within(dialog).getByDisplayValue("$100.00");
    await user.clear(valueInput);
    await user.type(valueInput, "200");
    await user.clear(within(dialog).getByDisplayValue("$45.00"));
    await user.clear(within(dialog).getByDisplayValue("$5.00"));
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(updateItemBody().changes).toEqual({ value: "$200.00", openingBid: "$90.00", minRaise: "$10.00" });
  });

  it("keeps an opening bid the user typed when the value changes", async () => {
    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    const valueInput = within(dialog).getByDisplayValue("$100.00");
    await user.clear(valueInput);
    await user.type(valueInput, "200");
    const openingInput = within(dialog).getByDisplayValue("$45.00");
    await user.clear(openingInput);
    await user.type(openingInput, "$70.00");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(updateItemBody().changes).toEqual({ value: "$200.00", openingBid: "$70.00" });
  });

  it("tells the user and reloads the list when the server says the item changed (409)", async () => {
    const { toast } = await import("sonner");
    mockedFetchWithRetry.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "This item changed since you opened it. Refresh the list and try again." }),
    } as Response);

    render(<AuctionItemsTab />);

    const row = screen.getByTestId("auction-item-row-2");
    await user.click(within(row).getByRole("button", { name: "Edit Food 1" }));

    const dialog = await screen.findByRole("dialog");
    const donorInput = within(dialog).getByDisplayValue("Donor A");
    await user.clear(donorInput);
    await user.type(donorInput, "Donor Z");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(toast.error).toHaveBeenCalledWith("This item changed since you opened it. Refresh the list and try again.");
    expect(mockRefresh).toHaveBeenCalled();
  });
});
