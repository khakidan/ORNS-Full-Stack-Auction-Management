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
});
