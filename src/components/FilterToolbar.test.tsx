/**
 * @vitest-environment jsdom
 *
 * Regression guard for a user-reported bug: Bidders.tsx's filter row (4
 * selects, after "Sort by" was added for the Attendee-List-style redesign)
 * wrapped onto 2-3 lines instead of staying on one row. See
 * docs/agents/CHANGELOG.md.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FilterToolbar } from "./FilterToolbar";

describe("FilterToolbar - filtersWrap", () => {
  it("wraps filters onto multiple lines by default, unchanged for every existing caller", () => {
    render(
      <FilterToolbar
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder="Search..."
        filters={<span>a filter</span>}
      />
    );

    const filterText = screen.getByText("a filter");
    expect(filterText.parentElement?.className).toContain("flex-wrap");
    expect(filterText.parentElement?.className).not.toContain("flex-nowrap");
  });

  it("keeps the filters together as one nowrap group when filtersWrap is false, and lets that group drop below the search box instead of showing a scrollbar", () => {
    render(
      <FilterToolbar
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder="Search..."
        filters={<span>a filter</span>}
        filtersWrap={false}
      />
    );

    const filterText = screen.getByText("a filter");
    expect(filterText.parentElement?.className).toContain("flex-nowrap");
    expect(filterText.parentElement?.className).toContain("overflow-x-auto");
    expect(filterText.parentElement?.className).not.toContain("flex-wrap");
    // A scrollbar under the dropdowns reserved ~15px of height, so they sat
    // above the centre of the bar. The group wraps as a unit instead, and
    // scrolls only when it's wider than the whole bar.
    expect(filterText.parentElement?.className).toContain("md:max-w-full");
    expect(filterText.parentElement?.parentElement?.className).toContain("md:flex-wrap");
  });

  it("doesn't wrap the search/filter row at all when filtersWrap is left at its default", () => {
    render(
      <FilterToolbar
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder="Search..."
        filters={<span>a filter</span>}
      />
    );

    expect(screen.getByText("a filter").parentElement?.parentElement?.className).not.toContain("md:flex-wrap");
  });
});

describe("FilterToolbar - Card wrapper", () => {
  it("renders its root as the shared Card component (data-slot=card), not a bare div, for every caller", () => {
    render(
      <FilterToolbar
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder="Search..."
      />
    );

    const input = screen.getByPlaceholderText("Search...");
    // input -> its relative wrapper div -> the flex-1 row div -> the Card root
    const root = input.parentElement?.parentElement?.parentElement;
    expect(root?.getAttribute("data-slot")).toBe("card");
  });
});
