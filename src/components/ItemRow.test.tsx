/**
 * @vitest-environment jsdom
 *
 * ItemRow.tsx's own unit tests - Items.tsx (its only real caller) always
 * filters to `status === "Active"` before rendering rows, so the
 * `bundleId && status === "Active"` guard on the Bundle badge (parity
 * with AuctionItemRow.tsx's identical convention) can never actually be
 * exercised with an inactive row through Items.test.tsx's integration
 * tests. Tested directly here instead.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ItemRow } from "./ItemRow";
import { AuctionItem } from "@/types";

function makeItem(overrides: Partial<AuctionItem> = {}): AuctionItem {
  return {
    id: "101",
    name: "Test Item",
    category: "Misc",
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

describe("ItemRow - Bundle badge", () => {
  it("shows the Bundle badge for an Active item with a bundleId", () => {
    render(<ItemRow item={makeItem({ bundleId: "BND-1", status: "Active" })} />);
    expect(screen.getByText("Bundle")).toBeInTheDocument();
  });

  it("hides the Bundle badge when bundleId is set but the item isn't Active", () => {
    render(<ItemRow item={makeItem({ bundleId: "BND-1", status: "Inactive" })} />);
    expect(screen.queryByText("Bundle")).not.toBeInTheDocument();
  });

  it("hides the Bundle badge when there's no bundleId at all", () => {
    render(<ItemRow item={makeItem({ bundleId: "", status: "Active" })} />);
    expect(screen.queryByText("Bundle")).not.toBeInTheDocument();
  });
});
