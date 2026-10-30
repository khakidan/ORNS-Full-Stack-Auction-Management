/**
 * @vitest-environment jsdom
 *
 * AuctionItemsTab.test.tsx mocks useBundling wholesale, so it never
 * exercises the real wiring between row selection, the bulk-action bar,
 * useBundling, and the real BundlingDialog. useBundling.ts itself is now
 * thoroughly covered in isolation (useBundling.test.ts via renderHook),
 * and BundlingDialog.tsx is already tested directly as a pure
 * presentational component (BundlingDialog.test.tsx) - what's covered
 * here is specifically the integration between them: does selecting real
 * items and clicking through the real UI actually produce the right
 * request.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, act, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuctionItemsTab from "./AuctionItemsTab";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: (_target, tag) =>
      ({ children, ...props }: any) => {
        const { createElement } = require('react');
        return createElement(String(tag), props, children);
      }
  }),
  AnimatePresence: ({ children }: any) => children,
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({ config: { auctionItemsSpreadsheetId: "test-sheet-id" } })
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({ isAuctionClosed: false })
}));

vi.mock("@/hooks/useAuctionItems", () => ({
  useAuctionItems: () => ({
    items: [
      { id: "101", rowIndex: 2, name: "Food 1", description: "Desc 1", category: "Food", value: "$100.00", openingBid: "$45.00", minRaise: "$5.00", donor: "Donor A", itemType: "Certificate", status: "Active" },
      { id: "102", rowIndex: 3, name: "Food 2", description: "Desc 2", category: "Food", value: "$200.00", openingBid: "$90.00", minRaise: "$10.00", donor: "Donor B", itemType: "Physical Item", status: "Active" },
    ],
    setItems: vi.fn(),
    categories: ["Food", "Health & Beauty"],
    valueCalculations: [],
    loading: false,
    refresh: vi.fn()
  })
}));

// useBundling is intentionally NOT mocked here - this file tests its real wiring.

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  deleteAuctionItem: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";

const mockedFetchWithRetry = vi.mocked(fetchWithRetry);

describe("AuctionItemsTab - real bundling wiring (useBundling unmocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selecting 2 items shows the bulk action bar with the real count", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    // Re-query fresh before each click - the base-ui Checkbox re-renders
    // its DOM node on state change, so a captured stale reference silently
    // no-ops on the second click.
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getAllByRole("checkbox")[2]);

    expect(screen.getByText("2 items selected")).toBeInTheDocument();
  });

  it("clicking Bundle opens the real dialog pre-filled with the real merged/calculated values", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getAllByRole("checkbox")[2]);
    fireEvent.click(screen.getByRole("button", { name: "Bundle" }));

    const dialog = await screen.findByRole("dialog");
    // Combined value $100 + $200 = $300, computed by the real calculateAutoBids.
    expect(within(dialog).getByDisplayValue("$300.00")).toBeInTheDocument();
    // Donors merged from both selected items.
    expect(within(dialog).getByDisplayValue("Donor A, Donor B")).toBeInTheDocument();
  });

  it("confirming a bundle sends the real request with the selected items' IDs and entered name", async () => {
    mockedFetchWithRetry.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ui_history_log: { bundle_item_name: "Combo Pack", bundle_token: "BND-1" } }),
    } as Response);
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getAllByRole("checkbox")[2]);
    fireEvent.click(screen.getByRole("button", { name: "Bundle" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByPlaceholderText(/Ultimate Family Staycation/i), "Combo Pack");
    await act(async () => {
      await user.click(within(dialog).getByRole("button", { name: /Confirm Bundle & Merge Rows/i }));
    });

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/api/bundle/process"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"targetIds":["101","102"]'),
      })
    );
    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.stringContaining('"newName":"Combo Pack"') })
    );
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Combo Pack"));
  });

  it("requires at least 2 items selected before the dialog opens", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    // The bulk action bar itself shows for any count >= 1 - only
    // openBundlingModal's own real guard (via useBundling) blocks opening
    // the dialog with fewer than 2 items selected.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: "Bundle" }));

    expect(toast.error).toHaveBeenCalledWith("Select at least 2 items to bundle");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
