/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FormSection } from "./FormSection";

describe("FormSection", () => {
  it("renders the uppercase title and its children", () => {
    render(
      <FormSection title="Pricing">
        <div>Value field</div>
      </FormSection>
    );

    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toHaveClass("uppercase");
    expect(screen.getByText("Value field")).toBeInTheDocument();
  });

  // Regression guard for the 2026-09-07 audit's tailwind-style-guide.md
  // finding: this label used a hardcoded text-[11px] arbitrary value
  // instead of the app's own sub-text-xs token - there's no sanctioned
  // 11px step, so a call site that needs "a little smaller than text-xs"
  // should use text-xxs (10px), not invent an in-between value.
  it("uses the app's text-xxs token, not a hardcoded arbitrary font-size value", () => {
    render(
      <FormSection title="Pricing">
        <div>Value field</div>
      </FormSection>
    );

    const label = screen.getByText("Pricing");
    expect(label).toHaveClass("text-xxs");
    expect(label.className).not.toContain("text-[11px]");
  });
});
