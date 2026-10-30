/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuctionItemsTab from "./AuctionItemsTab";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useAuctionItems } from "@/hooks/useAuctionItems";

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

// Quick trick to log sorting array
vi.spyOn(console, "log");

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

const defaultAuctionItemsReturn = {
  items: [
    { id: "101", rowIndex: 2, name: "Food 1", description: "Desc 1", category: "Food", value: "$100", donor: "Donor A", itemType: "Certificate", status: "Active" },
    { id: "102", rowIndex: 3, name: "Food 2", description: "Desc 2", category: "Food", value: "$200", donor: "Donor B", itemType: "Physical Item", status: "Active" },
    { id: "201", rowIndex: 4, name: "Health 1", description: "Desc 3", category: "Health & Beauty", value: "$50", donor: "Donor C", itemType: "Certificate", status: "Active" },
    { id: "202", rowIndex: 5, name: "Health 2", description: "Desc 4", category: "Health & Beauty", value: "$150", donor: "Donor D", itemType: "Physical Item", status: "Active" },
  ],
  setItems: vi.fn(),
  categories: ["Food", "Health & Beauty", "Travel"],
  categoriesWithBase: [],
  valueCalculations: [],
  loading: false,
  refresh: vi.fn()
};

vi.mock("@/hooks/useAuctionItems", () => ({
  useAuctionItems: vi.fn(() => defaultAuctionItemsReturn)
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

describe("AuctionItemsTab - Layout", () => {
  it("does not tint the 'Select all' bar's background, so it doesn't read as an oddly-empty highlighted box", () => {
    render(<AuctionItemsTab />);

    const selectAllText = screen.getByText(/Select all \d+ items/);
    const selectAllBar = selectAllText.parentElement;
    expect(selectAllBar?.className).not.toContain("bg-slate-50");
  });

  it("renders the search/filter bar above the Card, matching Bidders.tsx/TicketAttendeeTab.tsx's convention, instead of as a bespoke bar inside it", () => {
    render(<AuctionItemsTab />);

    const heading = screen.getByText("Auction Items Database");
    // Bare CardHeader (no override) is correct once the filter bar is no
    // longer a Card child - see CHANGELOG.md's "Search & Filter Actions
    // inside the main content area" fix.
    const cardHeader = heading.parentElement;
    expect(cardHeader?.className).not.toContain("flex-row");
  });
});

describe("AuctionItemsTab - Loading", () => {
  // While items are loading, the page now shows the filter bar and
  // RowListShell's skeleton rows inline (matching Items.tsx/Bidders.tsx's
  // convention) instead of replacing the whole page with a full-page
  // spinner - see CHANGELOG.md.
  it("keeps the filter bar visible and shows skeleton rows instead of blanking the whole page", () => {
    vi.mocked(useAuctionItems).mockReturnValueOnce({
      ...defaultAuctionItemsReturn,
      items: [],
      loading: true,
    });

    const { container } = render(<AuctionItemsTab />);

    expect(screen.getByPlaceholderText("Search by name, description, donor...")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});

describe("AuctionItemsTab - Sort and Filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Picks an option from one of the toolbar's real dropdowns. */
  async function choose(user: ReturnType<typeof userEvent.setup>, dropdown: string, option: string) {
    await user.click(screen.getByRole("combobox", { name: dropdown }));
    await user.click(await screen.findByRole("option", { name: option }));
  }

  it("Category filter - selecting 'Food' shows only Food items", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    await choose(user, "Filter by category", "Food");

    expect(screen.getByRole("combobox", { name: "Filter by category" })).toHaveTextContent("Food");
    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.getByText("Food 2")).toBeInTheDocument();
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Type filter - selecting 'Certificate' shows only Certificate items", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    await choose(user, "Filter by item type", "Certificate");

    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.getByText("Health 1")).toBeInTheDocument();
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Combined filter - Category AND Type", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    await choose(user, "Filter by category", "Food");
    await choose(user, "Filter by item type", "Certificate");

    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.queryByText("Food 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Health 2")).not.toBeInTheDocument();
  });

  it("Clearing a filter restores all items", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    await choose(user, "Filter by category", "Food");
    expect(screen.queryByText("Health 1")).not.toBeInTheDocument();

    await choose(user, "Filter by category", "All Categories");

    expect(screen.getByRole("combobox", { name: "Filter by category" })).toHaveTextContent("All Categories");
    expect(screen.getByText("Food 1")).toBeInTheDocument();
    expect(screen.getByText("Food 2")).toBeInTheDocument();
    expect(screen.getByText("Health 1")).toBeInTheDocument();
    expect(screen.getByText("Health 2")).toBeInTheDocument();
  });

  it("Sort by Category - items grouped", async () => {
    const user = userEvent.setup();
    render(<AuctionItemsTab />);

    // The old clickable column-header sort was replaced by a "Sort by"
    // select once the table became a flexible row list - see
    // CHANGELOG.md's "UI / Layout Tweaks" item.
    const rowOrder = () =>
      screen.getAllByTestId(/^auction-item-row-/).map((el) => el.getAttribute("data-testid"));

    await choose(user, "Sort items by", "Category (A to Z)");

    // Sorted by Category ascending: "Food" (rows 2,3) before "Health & Beauty" (rows 4,5).
    expect(rowOrder()).toEqual([
      "auction-item-row-2",
      "auction-item-row-3",
      "auction-item-row-4",
      "auction-item-row-5",
    ]);

    // Reverse sort
    await choose(user, "Sort items by", "Category (Z to A)");

    expect(rowOrder()).toEqual([
      "auction-item-row-4",
      "auction-item-row-5",
      "auction-item-row-2",
      "auction-item-row-3",
    ]);
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
