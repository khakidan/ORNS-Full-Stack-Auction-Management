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
import { AuctionItemsFilterBar } from "./AuctionItemsFilterBar";

const CATEGORIES = ["Arts, Crafts and Jewelry", "Entertainment & Experiences", "Food"];

function renderBar(overrides: Partial<ComponentProps<typeof AuctionItemsFilterBar>> = {}) {
  return render(
    <AuctionItemsFilterBar
      searchTerm=""
      onSearchTermChange={vi.fn()}
      selectedCategory="all"
      onSelectedCategoryChange={vi.fn()}
      selectedItemType="all"
      onSelectedItemTypeChange={vi.fn()}
      categories={CATEGORIES}
      onReset={vi.fn()}
      {...overrides}
    />
  );
}

describe("AuctionItemsFilterBar - Select display labels and popup width", () => {
  it("shows the friendly 'All Categories'/'All Types' labels, not the raw stored value 'all'", () => {
    renderBar();

    expect(screen.getByText("All Categories")).toBeInTheDocument();
    expect(screen.getByText("All Types")).toBeInTheDocument();
    expect(screen.queryByText("all")).not.toBeInTheDocument();
  });

  it("shows a real selected category's own name as the trigger label", () => {
    renderBar({ selectedCategory: "Food" });

    expect(screen.getAllByText("Food").length).toBeGreaterThan(0);
  });

  it("renders every category option's full, untruncated text when the dropdown is open", () => {
    renderBar();

    fireEvent.click(screen.getAllByRole("combobox")[0]);

    for (const category of CATEGORIES) {
      expect(screen.getByText(category)).toBeInTheDocument();
    }
  });
});
