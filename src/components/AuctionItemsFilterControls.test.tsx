/**
 * @vitest-environment jsdom
 *
 * Two real bugs reported by the user via screenshots of the Auction Items
 * table's Category/Item Type filters: (1) the trigger showed the raw
 * stored value "all" instead of "All Categories"/"All Types" - the same
 * bare-<SelectValue /> gap already fixed elsewhere this session, never
 * caught here because AuctionItemsTab.test.tsx mocks @/components/ui/select
 * wholesale; (2) once open, long category names ("Arts, Crafts and
 * Jewelry", "Entertainment & Experiences") were visually cut off with no
 * ellipsis - the popup's width is bound to the (narrow) trigger's width
 * via select.tsx's `w-(--anchor-width)`, and SelectItem's text is
 * `whitespace-nowrap` inside an `overflow-x-hidden` popup, so anything
 * wider than the trigger just vanishes past the edge. The real
 * @base-ui/react Select is deliberately left unmocked here.
 */
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AuctionItemsFilterControls } from "./AuctionItemsFilterControls";

const CATEGORIES = ["Arts, Crafts and Jewelry", "Entertainment & Experiences", "Food"];

function renderControls(overrides: Partial<ComponentProps<typeof AuctionItemsFilterControls>> = {}) {
  return render(
    <AuctionItemsFilterControls
      selectedCategory="all"
      onSelectedCategoryChange={vi.fn()}
      selectedItemType="all"
      onSelectedItemTypeChange={vi.fn()}
      categories={CATEGORIES}
      onReset={vi.fn()}
      sortConfig={{ key: "id", direction: "asc" }}
      onSortConfigChange={vi.fn()}
      {...overrides}
    />
  );
}

describe("AuctionItemsFilterControls - Select display labels and popup width", () => {
  it("shows the friendly 'All Categories'/'All Types' labels, not the raw stored value 'all'", () => {
    renderControls();

    expect(screen.getByText("All Categories")).toBeInTheDocument();
    expect(screen.getByText("All Types")).toBeInTheDocument();
    expect(screen.queryByText("all")).not.toBeInTheDocument();
  });

  it("shows a real selected category's own name as the trigger label", () => {
    renderControls({ selectedCategory: "Food" });

    expect(screen.getAllByText("Food").length).toBeGreaterThan(0);
  });

  it("renders every category option's full, untruncated text when the dropdown is open", () => {
    renderControls();

    fireEvent.click(screen.getAllByRole("combobox")[0]);

    for (const category of CATEGORIES) {
      expect(screen.getByText(category)).toBeInTheDocument();
    }
  });
});

describe("AuctionItemsFilterControls - Reset", () => {
  it("calls onReset when 'Reset Filters' is clicked", () => {
    const onReset = vi.fn();
    renderControls({ onReset });

    fireEvent.click(screen.getByText("Reset Filters"));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("AuctionItemsFilterControls - Sort by trigger width", () => {
  // Regression guard for the same clipped-Sort-by-trigger bug reported on
  // Bidders.tsx (BiddersFilterControls.tsx uses the identical w-50
  // pattern) - fixed here too for consistency, since this component's
  // own longest label ("Item # (Low to High)"/"Item # (High to Low)",
  // 21 characters) plus its icon hits the same width shortfall. Sized to
  // w-52 (208px), not larger, per the Bidders.tsx fix's lesson: widening
  // the trigger more than the longest label needs pushes the whole filter
  // row's total width past what fits on the search box's row. (Was w-60;
  // trimmed so the bar fits on one row at a 1470px-wide window. Measured
  // in a real browser at w-52: the longest label still leaves 16px before
  // the dropdown arrow, and no sort label is clipped.)
  it("is wide enough to fit the sort option labels without clipping", () => {
    renderControls();

    const sortValue = screen.getByText("Item # (Low to High)");
    const trigger = sortValue.closest('[data-slot="select-trigger"]');
    expect(trigger?.className).toContain("w-52");
    expect(trigger?.className).not.toContain("w-50");
    expect(trigger?.className).not.toContain("w-60");
  });
});
