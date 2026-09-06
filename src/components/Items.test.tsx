/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import Items from "./Items";
import { useAuction } from "@/context/AuctionContext";
import { AuctionItem } from "@/types";

// Mock the Auction Context
vi.mock("@/context/AuctionContext", () => ({
  useAuction: vi.fn(),
}));

const mockItems: AuctionItem[] = [
  { id: "101", name: "Vintage Camera", category: "Collectibles", description: "Old camera", value: "100", openingBid: "50", minRaise: "10", donor: "Donor A", itemType: "Auction", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 2 },
  { id: "102", name: "Modern Lamp", category: "Decor", description: "Bright lamp", value: "200", openingBid: "100", minRaise: "20", donor: "Donor B", itemType: "Auction", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 3 },
  { id: "201", name: "Silver Watch", category: "Jewelry", description: "Nice watch", value: "300", openingBid: "150", minRaise: "30", donor: "Donor C", itemType: "Auction", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 4 },
  { id: "202", name: "Gold Ring", category: "Jewelry", description: "Shiny ring", value: "400", openingBid: "200", minRaise: "40", donor: "Donor D", itemType: "Auction", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 5 },
];

describe("Items - Search", () => {
  beforeEach(() => {
    vi.mocked(useAuction).mockReturnValue({
      items: mockItems,
      winners: {},
      loading: false,
    } as any);
  });

  it("Search finds matching item by name: Type a partial name matching exactly one item → assert only that item is visible", async () => {
    const user = userEvent.setup();
    render(<Items />);
    
    const searchInput = screen.getByPlaceholderText(/Search items by box number or name.../i);
    await user.type(searchInput, "Vintage");
    
    expect(screen.getByText("Vintage Camera")).toBeInTheDocument();
    expect(screen.queryByText("Modern Lamp")).not.toBeInTheDocument();
    expect(screen.queryByText("Silver Watch")).not.toBeInTheDocument();
    expect(screen.queryByText("Gold Ring")).not.toBeInTheDocument();
  });

  it("Search finds matching item by box number: Type a box number matching exactly one item → assert only that item is visible", async () => {
    const user = userEvent.setup();
    render(<Items />);
    
    const searchInput = screen.getByPlaceholderText(/Search items by box number or name.../i);
    await user.type(searchInput, "201");
    
    expect(screen.getByText("201")).toBeInTheDocument();
    expect(screen.getByText("Silver Watch")).toBeInTheDocument();
  });

  it("Search is case-insensitive: Type an uppercase version of a name → assert the same item is found", async () => {
    const user = userEvent.setup();
    render(<Items />);
    
    const searchInput = screen.getByPlaceholderText(/Search items by box number or name.../i);
    await user.type(searchInput, "GOLD RING");
    
    expect(screen.getByText("Gold Ring")).toBeInTheDocument();
    expect(screen.queryByText("Vintage Camera")).not.toBeInTheDocument();
  });

  it("Search finds no results for unmatched query: Type a string matching nothing → assert no items visible", async () => {
    const user = userEvent.setup();
    render(<Items />);
    
    const searchInput = screen.getByPlaceholderText(/Search items by box number or name.../i);
    await user.type(searchInput, "XYZ123");
    
    expect(screen.getByText("No items match your search.")).toBeInTheDocument();
  });

  it("Dynamic search — results update on each keystroke: Type characters matching multiple items, then narrow to one → assert correct visibility at each step", async () => {
    const user = userEvent.setup();
    render(<Items />);
    
    const searchInput = screen.getByPlaceholderText(/Search items by box number or name.../i);
    
    // Type 'Go' - matches Gold Ring
    await user.type(searchInput, "Go");
    expect(screen.getByText("Gold Ring")).toBeInTheDocument();
    expect(screen.queryByText("Vintage Camera")).not.toBeInTheDocument();
    expect(screen.queryByText("Modern Lamp")).not.toBeInTheDocument();
    expect(screen.queryByText("Silver Watch")).not.toBeInTheDocument();
    
    // Narrow to 'Gold Ring'
    await user.type(searchInput, "ld Ring");
    expect(screen.getByText("Gold Ring")).toBeInTheDocument();
    expect(screen.queryByText("Vintage Camera")).not.toBeInTheDocument();
  });

  it("Clearing the search field restores all items: Type then user.clear(input) → assert all 4 items visible again", async () => {
    const user = userEvent.setup();
    render(<Items />);

    const searchInput = screen.getByPlaceholderText(/Search items by box number or name.../i);
    await user.type(searchInput, "Camera");

    await user.clear(searchInput);

    expect(screen.getByText("Vintage Camera")).toBeInTheDocument();
    expect(screen.getByText("Modern Lamp")).toBeInTheDocument();
    expect(screen.getByText("Silver Watch")).toBeInTheDocument();
    expect(screen.getByText("Gold Ring")).toBeInTheDocument();
  });
});

describe("Items - Ordering", () => {
  // Regression guard for a user-reported bug: the catalog rendered items
  // in whatever row order the spreadsheet happened to have (which can
  // drift from numeric order after edits/bundles/deletions, since
  // resequencing only changes an item's ID value, not its row position),
  // not sorted numerically by item number. See docs/agents/CHANGELOG.md.
  it("renders items sorted numerically by item number, regardless of the order they arrive in", () => {
    const outOfOrderItems: AuctionItem[] = [
      { id: "102", name: "Art#1", category: "Classroom Art", description: "", value: "", openingBid: "", minRaise: "", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 2 },
      { id: "201", name: "Art 2", category: "Arts, Crafts and Jewelry", description: "", value: "", openingBid: "", minRaise: "", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 3 },
      { id: "101", name: "Art 3", category: "Classroom Art", description: "", value: "", openingBid: "", minRaise: "", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 4 },
      { id: "401", name: "Basket Name 1", category: "Fitness", description: "", value: "", openingBid: "", minRaise: "", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 5 },
    ];
    vi.mocked(useAuction).mockReturnValue({
      items: outOfOrderItems,
      winners: {},
      loading: false,
    } as any);

    render(<Items />);

    const idCells = screen.getAllByText(/^(101|102|201|401)$/);
    expect(idCells.map((el) => el.textContent)).toEqual(["101", "102", "201", "401"]);
  });
});