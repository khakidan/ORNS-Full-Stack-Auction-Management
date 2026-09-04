/**
 * @vitest-environment jsdom
 *
 * Regression guard for the keyboard-focus-reveal gap flagged in
 * refactor-opportunities.md: the edit-trigger IconButton is hidden via
 * `opacity-0 group-hover:opacity-100`, which never reveals it for a
 * keyboard user tabbing to it without a mouse hovering the row -
 * component-standards.md requires focus outlines never be removed
 * without replacement. jsdom doesn't apply real CSS (no computed
 * opacity to read), so the only way to pin this fix here is asserting
 * the `group-focus-within:opacity-100` class itself is present
 * alongside the existing `group-hover:opacity-100` - a real browser
 * then reveals the button whenever any descendant of the `group`
 * wrapper (including the button itself) has focus.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { EditableCell } from "./EditableCell";

describe("EditableCell - edit-trigger keyboard-focus reveal", () => {
  it("reveals the edit button on focus-within, not just hover", () => {
    render(<EditableCell value="Some Value" onSave={() => {}} />);

    const editButton = screen.getByRole("button", { name: "Edit" });
    expect(editButton.className).toContain("group-hover:opacity-100");
    expect(editButton.className).toContain("group-focus-within:opacity-100");
  });

  it("keeps the edit button reachable by keyboard even while visually hidden", () => {
    render(<EditableCell value="Some Value" onSave={() => {}} />);

    const editButton = screen.getByRole("button", { name: "Edit" });
    expect(editButton).not.toBeDisabled();
    expect(editButton.tabIndex).not.toBe(-1);
  });
});
