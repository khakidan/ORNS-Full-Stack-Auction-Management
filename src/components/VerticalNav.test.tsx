// @vitest-environment jsdom
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerticalNav } from "./VerticalNav";

const items = [
  { value: "a", label: "Alpha", badge: 3 },
  { value: "b", label: "Beta" },
];

describe("VerticalNav", () => {
  it("marks the current section and reports the one clicked", async () => {
    const onValueChange = vi.fn();
    render(<VerticalNav label="Sections" items={items} value="a" onValueChange={onValueChange} />);

    const rail = screen.getByRole("navigation", { name: "Sections" });
    expect(rail.querySelector('[aria-current="page"]')).toHaveTextContent("Alpha");
    expect(rail).toHaveTextContent("3");

    await userEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});
