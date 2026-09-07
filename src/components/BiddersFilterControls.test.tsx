/**
 * @vitest-environment jsdom
 *
 * component-standards.md documents that SelectValue with no children
 * renders the raw stored value, not the matching SelectItem's label -
 * all three of this component's selects had exactly that gap (flagged
 * in refactor-opportunities.md). Bidders.test.tsx mocks
 * @/components/ui/select wholesale, so it could never have caught this -
 * the real @base-ui/react Select is deliberately left unmocked here.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BiddersFilterControls } from "./BiddersFilterControls";
import { BidderSortConfig } from "@/hooks/useBiddersState";

function renderControls(overrides: Partial<{ statusFilter: string; paymentFilter: string; sourceFilter: string; sortConfig: BidderSortConfig | null }> = {}) {
  return render(
    <BiddersFilterControls
      statusFilter={overrides.statusFilter ?? "all"}
      onStatusFilterChange={() => {}}
      paymentFilter={overrides.paymentFilter ?? "all"}
      onPaymentFilterChange={() => {}}
      sourceFilter={overrides.sourceFilter ?? "all"}
      onSourceFilterChange={() => {}}
      sortConfig={overrides.sortConfig ?? { key: "id", direction: "asc" }}
      onSortConfigChange={() => {}}
    />
  );
}

describe("BiddersFilterControls - display labels", () => {
  it("shows the friendly status label, not the raw stored value", () => {
    renderControls({ statusFilter: "checked-in" });

    expect(screen.getByText("Checked In")).toBeInTheDocument();
    expect(screen.queryByText("checked-in")).not.toBeInTheDocument();
  });

  it("shows the friendly payment label, not the raw stored value", () => {
    renderControls({ paymentFilter: "paid" });

    expect(screen.getByText("Paid")).toBeInTheDocument();
  });

  it("shows the friendly source label, not the raw stored value", () => {
    renderControls({ sourceFilter: "sponsors" });

    expect(screen.getByText("Sponsors")).toBeInTheDocument();
    expect(screen.queryByText("sponsors")).not.toBeInTheDocument();
  });

  it("shows the friendly sort label, not the raw encoded value", () => {
    renderControls({ sortConfig: { key: "name", direction: "desc" } });

    expect(screen.getByText("Name (Z to A)")).toBeInTheDocument();
    expect(screen.queryByText("name-desc")).not.toBeInTheDocument();
  });

  it("shows the default 'All ...' labels for the all-filters state", () => {
    renderControls();

    expect(screen.getByText("All Statuses")).toBeInTheDocument();
    expect(screen.getByText("All Payments")).toBeInTheDocument();
    expect(screen.getByText("All Sources")).toBeInTheDocument();
    expect(screen.getByText("Bidder # (Low to High)")).toBeInTheDocument();
  });
});

describe("BiddersFilterControls - Sort by trigger width", () => {
  // Regression guard for a user-reported bug: the Sort by trigger was
  // fixed at w-50 (200px), too narrow for its own longest label, so the
  // currently-selected label got clipped instead of fitting. A first fix
  // just widened the trigger (to w-72) without changing anything else -
  // that made the trigger's own text fit, but pushed the whole 4-filter
  // row's total width over what fits in the toolbar without horizontal
  // scrolling, the opposite of what was asked for ("show all options
  // without scrolling"). Fixed properly by shortening the two longest
  // labels (dropping the redundant "Status " prefix - "Status
  // (Checked-In First)"/"Status (Not Present First)" -> "Checked-In
  // First"/"Not Present First") so a smaller width increase (w-50 -> w-64)
  // suffices, and by narrowing the search input (Bidders.tsx's
  // searchClassName) to free up the rest of the room the wider trigger
  // needs - see Bidders.tsx.
  it("is wide enough to fit the longest sort option label without clipping", () => {
    renderControls();

    const sortValue = screen.getByText("Bidder # (Low to High)");
    const trigger = sortValue.closest('[data-slot="select-trigger"]');
    expect(trigger?.className).toContain("w-64");
    expect(trigger?.className).not.toContain("w-50");
  });

  it("shortens the two Status sort labels so the trigger doesn't need to be as wide as the full 'Status (...)' phrasing would require", () => {
    renderControls({ sortConfig: { key: "status", direction: "desc" } });
    expect(screen.getByText("Checked-In First")).toBeInTheDocument();
    expect(screen.queryByText("Status (Checked-In First)")).not.toBeInTheDocument();
  });
});
