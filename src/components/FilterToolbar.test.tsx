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

  it("keeps filters on one row (scrollable, not wrapping) when filtersWrap is false", () => {
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
  });
});
