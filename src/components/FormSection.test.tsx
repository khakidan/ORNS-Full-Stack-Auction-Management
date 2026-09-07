/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AuctionItemFormSection } from "./AuctionItemFormSection";

describe("AuctionItemFormSection", () => {
  it("renders the uppercase title and its children", () => {
    render(
      <AuctionItemFormSection title="Pricing">
        <div>Value field</div>
      </AuctionItemFormSection>
    );

    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toHaveClass("uppercase");
    expect(screen.getByText("Value field")).toBeInTheDocument();
  });
});
