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

// Regression guard for user feedback after the first pass: itemType used
// to render as plain text on the financial-figures line instead of a
// colored Badge inline with the category/Bundle badges. See
// docs/agents/CHANGELOG.md.
describe("ItemRow - itemType badge", () => {
  it("renders each known itemType as a colored badge with a distinct icon/class", () => {
    // React reuses the same DOM node across `rerender` calls at the same
    // tree position - snapshotting `.className` into a plain string right
    // after each render (not holding onto the live element) is what makes
    // the later cross-render comparisons meaningful, since the element
    // reference itself gets mutated in place by the next rerender.
    const { rerender } = render(<ItemRow item={makeItem({ itemType: "Physical Item" })} />);
    const physicalClass = screen.getByText("Physical Item").closest("span")?.className ?? "";
    expect(physicalClass).toContain("bg-sky-50");

    rerender(<ItemRow item={makeItem({ itemType: "Certificate" })} />);
    const certificateClass = screen.getByText("Certificate").closest("span")?.className ?? "";
    expect(certificateClass).toContain("bg-amber-50");

    rerender(<ItemRow item={makeItem({ itemType: "Both" })} />);
    const bothClass = screen.getByText("Both").closest("span")?.className ?? "";
    expect(bothClass).toContain("bg-teal-50");

    // Different itemTypes must not share a color, or the badges lose the
    // "varied per type" distinction the user asked for.
    expect(physicalClass).not.toBe(certificateClass);
    expect(certificateClass).not.toBe(bothClass);
  });

  it("renders no itemType badge when the item has no itemType set", () => {
    render(<ItemRow item={makeItem({ itemType: "" })} />);
    expect(screen.queryByText("Physical Item")).not.toBeInTheDocument();
    expect(screen.queryByText("Certificate")).not.toBeInTheDocument();
    expect(screen.queryByText("Both")).not.toBeInTheDocument();
  });
});

// Regression guard: every category used to render as the same plain
// `variant="outline"` badge with no color at all. See CHANGELOG.md.
describe("ItemRow - category badge coloring", () => {
  it("gives the same category the same color every time (deterministic, not random per render)", () => {
    const { unmount } = render(<ItemRow item={makeItem({ category: "Classroom Art" })} />);
    const firstClass = screen.getByText("Classroom Art").className;
    unmount();

    render(<ItemRow item={makeItem({ category: "Classroom Art" })} />);
    const secondClass = screen.getByText("Classroom Art").className;

    expect(firstClass).toBe(secondClass);
    // A real color utility class, not the old flat "outline" style.
    expect(firstClass).toMatch(/bg-\w+-50/);
  });

  it("gives visibly different categories different colors", () => {
    render(
      <>
        <ItemRow item={makeItem({ id: "1", category: "Classroom Art" })} />
        <ItemRow item={makeItem({ id: "2", category: "Food & Drink" })} />
      </>
    );

    const artClass = screen.getByText("Classroom Art").className;
    const foodClass = screen.getByText("Food & Drink").className;
    expect(artClass).not.toBe(foodClass);
  });
});

// Regression guard: donor used to render on its own separate line with a
// User icon; the user asked for it to sit inline with Value/Opening/Raise
// instead (keeping an icon, just moved). See CHANGELOG.md.
describe("ItemRow - donor placement", () => {
  it("renders donor inline within the same financial-figures line as Value/Opening/Raise", () => {
    render(<ItemRow item={makeItem({ value: "$100", openingBid: "$50", minRaise: "$10", donor: "Acme Co" })} />);

    const donorText = screen.getByText("Acme Co");
    const valueText = screen.getByText("$100");
    // Both must share the same immediate flex-row container.
    expect(donorText.closest("div")).toBe(valueText.closest("div"));
  });
});

describe("ItemRow - description", () => {
  // jsdom has no layout, so truncation can't be measured; a line-clamp or
  // truncate class is what cuts a description off in the browser.
  it("shows the whole description, never clamped or truncated", () => {
    const description = "Line one of a long description. ".repeat(20) + "THE END";
    render(<ItemRow item={makeItem({ description })} />);

    const el = screen.getByText(/THE END$/);
    expect(el.textContent).toBe(description);
    expect(el.className).not.toMatch(/line-clamp|truncate|overflow-hidden/);
  });
});
