/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CheckoutStatsRow } from "./CheckoutStatsRow";

describe("CheckoutStatsRow", () => {
  it("renders all four stats with formatted currency", () => {
    render(
      <CheckoutStatsRow
        totalWinners={18}
        awaitingCount={7}
        checkedOutCount={11}
        totalCollected={4285}
        totalWon={6910}
      />
    );

    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getByText("$4,285.00")).toBeInTheDocument();
    expect(screen.getByText("of $6,910.00 won")).toBeInTheDocument();
  });

  it("renders zeroes without crashing when there are no winners yet", () => {
    render(
      <CheckoutStatsRow
        totalWinners={0}
        awaitingCount={0}
        checkedOutCount={0}
        totalCollected={0}
        totalWon={0}
      />
    );

    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});
