/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("renders the label, icon, and value", () => {
    render(<StatTile label="Total Items" icon={<span data-testid="icon" />} value={42} />);

    expect(screen.getByText("Total Items")).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders subtext only when provided", () => {
    const { rerender } = render(<StatTile label="A" icon={null} value={1} subtext={<p>helper text</p>} />);
    expect(screen.getByText("helper text")).toBeInTheDocument();

    rerender(<StatTile label="A" icon={null} value={1} />);
    expect(screen.queryByText("helper text")).not.toBeInTheDocument();
  });

  it("applies valueClassName to the value, not the label or subtext", () => {
    render(<StatTile label="A" icon={null} value="$4,285.00" valueClassName="text-orns-red" subtext={<p>of $6,910.00 won</p>} />);

    expect(screen.getByText("$4,285.00").className).toContain("text-orns-red");
    expect(screen.getByText("A").className).not.toContain("text-orns-red");
    expect(screen.getByText("of $6,910.00 won").className).not.toContain("text-orns-red");
  });

  it("accepts a ReactNode value with mixed content, not just a plain string/number", () => {
    render(<StatTile label="Checkout Status" icon={null} value={<>7 <span>Checked Out</span></>} />);

    const checkedOut = screen.getByText("Checked Out");
    expect(checkedOut).toBeInTheDocument();
    expect(checkedOut.parentElement?.textContent).toBe("7 Checked Out");
  });
});
