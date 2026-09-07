/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConfigErrorCard } from "./ConfigErrorCard";

describe("ConfigErrorCard", () => {
  it("renders the icon, title, and description inside a centered Card", () => {
    const { container } = render(
      <ConfigErrorCard icon={<span data-testid="icon" />} title="Not Configured" description="Please set the ID in Settings." />
    );

    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("Not Configured")).toBeInTheDocument();
    expect(screen.getByText("Please set the ID in Settings.")).toBeInTheDocument();

    // Regression guard for the real drift bug the 2026-09-07 audit found:
    // AuctionItemsTab.tsx's own copy of this block was missing these
    // centering classes, so its placeholder rendered top-aligned instead
    // of vertically centered like Receipts.tsx/BugReportsAdmin.tsx.
    const cardContent = screen.getByText("Not Configured").closest('[data-slot="card-content"]');
    expect(cardContent?.className).toContain("h-100");
    expect(cardContent?.className).toContain("items-center");
    expect(cardContent?.className).toContain("justify-center");
  });
});
