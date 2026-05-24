/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
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

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select 
      value={value} 
      onChange={(e) => {
        onValueChange(e.target.value);
      }}
      data-testid="mock-select"
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <option value="" disabled>{placeholder}</option>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

// Quick trick to log sorting array
vi.spyOn(console, "log");

window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: {
      auctionItemsSpreadsheetId: "test-sheet-id",
    }
  })
}));

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    isAuctionClosed: false,
  })
}));

vi.mock("@/hooks/useAuctionItems", () => ({
  useAuctionItems: () => ({
    items: [
      { id: "101", rowIndex: 2, name: "Food 1", description: "Desc 1", category: "Food", value: "$100", donor: "Donor A", itemType: "Certificate", status: "Active" },
      { id: "102", rowIndex: 3, name: "Food 2", description: "Desc 2", category: "Food", value: "$200", donor: "Donor B", itemType: "Physical Item", status: "Active" },
      { id: "201", rowIndex: 4, name: "Health 1", description: "Desc 3", category: "Health & Beauty", value: "$50", donor: "Donor C", itemType: "Certificate", status: "Active" },
      { id: "202", rowIndex: 5, name: "Health 2", description: "Desc 4", category: "Health & Beauty", value: "$150", donor: "Donor D", itemType: "Physical Item", status: "Active" },
    ],
    setItems: vi.fn(),
    categories: ["Food", "Health & Beauty", "Travel"],
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
    setRestoreBundleId: vi.fn(),
    isExecutingRestore: false,
    openBundlingModal: vi.fn(),
    getAiSuggestions: vi.fn(),
    getAiDescriptionSuggestion: vi.fn(),
    executeBundle: vi.fn(),
    handleRestoreBundle: vi.fn()
  })
}));

describe("AuctionItemsTab - Sort and Filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Category filter - selecting 'Food' shows only Food items", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    const selects = screen.getAllByTestId("mock-select");
    const categorySelect = selects[0];
    fireEvent.change(categorySelect, { target: { value: "Food" } });

    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.getByText("Food 2")).toBeInTheDocument();
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Type filter - selecting 'Certificate' shows only Certificate items", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    const selects = screen.getAllByTestId("mock-select");
    const typeSelect = selects[1];
    fireEvent.change(typeSelect, { target: { value: "Certificate" } });

    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.getByText("Health 1")).toBeInTheDocument();
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Combined filter - Category AND Type", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    const selects = screen.getAllByTestId("mock-select");
    fireEvent.change(selects[0], { target: { value: "Food" } });
    fireEvent.change(selects[1], { target: { value: "Certificate" } });

    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Clearing a filter restores all items", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    const selects = screen.getAllByTestId("mock-select");
    const categorySelect = selects[0];
    fireEvent.change(categorySelect, { target: { value: "Food" } });
    
    // verify filter applied
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();

    // clear it
    fireEvent.change(categorySelect, { target: { value: "all" } });

    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.getByText("Food 2")).toBeInTheDocument();
    expect(screen.getByText("Health 1")).toBeInTheDocument();
    expect(screen.getByText("Health 2")).toBeInTheDocument();
  });

  it("Sort by Category - items grouped", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    // Click Category column header
    // Use getByRole if possible, or getByText
    const categoryHeader = screen.getByRole("columnheader", { name: /category/i });
    await user.click(categoryHeader);

    // Get the rows after sorting.
    // The rendered EditableCells use inputs, so we can check the values.
    // Alternatively, we can just find all rows and verify the order.
    const allRows = screen.getAllByRole("row");
    // Row 0 is header. Rows 1..4 are data rows.
    
    // Check they are sorted by Category: "Food", "Food", "Health & Beauty", "Health & Beauty"
    // Since "Food" < "Health & Beauty", ascending order.
    // To identify rows, we can check the content of the first few columns
    
    expect(within(allRows[1]).getByText("Food 1")).toBeInTheDocument();
    expect(within(allRows[2]).getByText("Food 2")).toBeInTheDocument();
    expect(within(allRows[3]).getByText("Health 1")).toBeInTheDocument();
    expect(within(allRows[4]).getByText("Health 2")).toBeInTheDocument();
    
    // Reverse sort
    await user.click(categoryHeader);
    
    const allRowsDesc = screen.getAllByRole("row");
    expect(within(allRowsDesc[1]).getByText("Health 1")).toBeInTheDocument();
    expect(within(allRowsDesc[2]).getByText("Health 2")).toBeInTheDocument();
    expect(within(allRowsDesc[3]).getByText("Food 1")).toBeInTheDocument();
    expect(within(allRowsDesc[4]).getByText("Food 2")).toBeInTheDocument();
  });
});

describe("AuctionItemsTab - Search", () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
  });

  it("Search finds matching item by name", async () => {
    render(<AuctionItemsTab />);
    const searchInput = screen.getByPlaceholderText(/search by name, description, donor/i);

    await user.type(searchInput, "Food 1");

    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Search is case-insensitive", async () => {
    render(<AuctionItemsTab />);
    const searchInput = screen.getByPlaceholderText(/search by name, description, donor/i);

    await user.type(searchInput, "FOOD 1");

    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Search finds no results for unmatched query", async () => {
    render(<AuctionItemsTab />);
    const searchInput = screen.getByPlaceholderText(/search by name, description, donor/i);

    await user.type(searchInput, "unmatched-query-string-xyz");

    expect(screen.queryByText("Food 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Search is dynamic — results update on each keystroke", async () => {
    render(<AuctionItemsTab />);
    const searchInput = screen.getByPlaceholderText(/search by name, description, donor/i);

    // Type first letter 'F'
    await user.type(searchInput, "F");
    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.getByText("Food 2")).toBeInTheDocument();
    expect(screen.getByText("Health 1")).toBeInTheDocument(); // Because "Certificate" contains 'f'
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();

    // Type the rest to narrow down to "Food 1"
    await user.type(searchInput, "ood 1");
    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Clearing the search field restores all items", async () => {
    render(<AuctionItemsTab />);
    const searchInput = screen.getByPlaceholderText(/search by name, description, donor/i);

    await user.type(searchInput, "Food 1");
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();

    // Clear search
    await user.clear(searchInput);
    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.getByText("Food 2")).toBeInTheDocument();
    expect(screen.getByText("Health 1")).toBeInTheDocument();
    expect(screen.getByText("Health 2")).toBeInTheDocument();
  });
});
