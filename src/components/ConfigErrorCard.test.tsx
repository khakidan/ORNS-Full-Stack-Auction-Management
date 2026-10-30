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
  });
});
