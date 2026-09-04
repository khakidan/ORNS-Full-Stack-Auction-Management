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

function renderControls(overrides: Partial<{ statusFilter: string; paymentFilter: string; sourceFilter: string }> = {}) {
  return render(
    <BiddersFilterControls
      statusFilter={overrides.statusFilter ?? "all"}
      onStatusFilterChange={() => {}}
      paymentFilter={overrides.paymentFilter ?? "all"}
      onPaymentFilterChange={() => {}}
      sourceFilter={overrides.sourceFilter ?? "all"}
      onSourceFilterChange={() => {}}
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

  it("shows the default 'All ...' labels for the all-filters state", () => {
    renderControls();

    expect(screen.getByText("All Statuses")).toBeInTheDocument();
    expect(screen.getByText("All Payments")).toBeInTheDocument();
    expect(screen.getByText("All Sources")).toBeInTheDocument();
  });
});
