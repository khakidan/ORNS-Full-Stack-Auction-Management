/**
 * @vitest-environment jsdom
 *
 * User-reported bug, filed as 3 near-duplicate bug reports against 3
 * different screens (AddAuctionItemDialog.tsx's "Create Item" Category
 * select, AuctionItemsFilterControls.tsx's filter Category select,
 * AuctionItemsBulkActionBar.tsx's bulk "Set Category" select) that all
 * shared one root cause in this shared component: SelectContent's popup
 * width was hard-bound to the trigger's own width via `w-(--anchor-width)`,
 * with only a flat `min-w-36` (144px) floor - so a long category name
 * (e.g. "Arts, Crafts and Jewelry") rendered wider than a narrow trigger
 * got silently clipped by the popup's `overflow-x-hidden`, no ellipsis,
 * no scrollbar. Fixed at the shared-component level (not per call site,
 * since a 4th, unreported instance - ui/EditableCell.tsx's inline
 * category-editing select - had the identical latent bug and would have
 * been missed by a per-file patch): the popup now sizes to its own
 * content (`w-max`) with a `min-w-(--anchor-width)` floor, so it's never
 * narrower than the trigger it opens from but grows to fit whatever text
 * its items actually contain. jsdom has no real layout engine, so this
 * can't prove pixel-level clipping is gone (AuctionItemsFilterControls.test.tsx
 * already covers that full untruncated text is present in the DOM once
 * open) - this test instead pins the actual className the popup renders
 * with, the same "assert on the class string itself" exception this
 * codebase already uses elsewhere for identical jsdom limitations.
 */
import "@testing-library/jest-dom";
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

function renderSelect() {
  return render(
    <Select defaultValue="a">
      <SelectTrigger className="w-20">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">A Very Long Option That Would Overflow A Narrow Trigger</SelectItem>
        <SelectItem value="b">B</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * User-reported bug: "the filter dropdowns aren't centered in the filter
 * bar". Every filter dropdown passed `h-10` to match the 40px search box
 * and buttons beside it, but the trigger's own height was
 * `data-[size=default]:h-8` - an attribute selector, which beats any plain
 * `h-*` utility in CSS - so `h-10` never applied. The dropdowns stayed
 * 32px tall and sat at the top of the 40px row. Measured in a real
 * browser (Playwright, 1470px wide): the dropdowns' vertical centre was
 * 72px vs 76px for the search box before the fix, 76px for all after.
 * jsdom has no layout engine, so this pins the class string, the same
 * exception used for the popup width below.
 */
describe("SelectTrigger height", () => {
  const renderTrigger = (props: { className?: string; size?: "sm" | "default" }) =>
    render(
      <Select defaultValue="a">
        <SelectTrigger {...props}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    );

  it("is 32px (h-8) by default", () => {
    renderTrigger({});
    const trigger = document.querySelector('[data-slot="select-trigger"]');
    expect(trigger).toHaveClass("h-8");
  });

  it("lets a height passed by the caller replace the default, rather than losing to it", () => {
    renderTrigger({ className: "h-10 w-45" });
    const trigger = document.querySelector('[data-slot="select-trigger"]');
    expect(trigger).toHaveClass("h-10");
    expect(trigger).not.toHaveClass("h-8");
    // The old data-attribute form can't be overridden by a plain h-* class.
    expect(trigger?.className).not.toMatch(/data-\[size=default\]:h-8/);
  });

  it("keeps the smaller size for size=sm", () => {
    renderTrigger({ size: "sm" });
    expect(document.querySelector('[data-slot="select-trigger"]')?.className).toContain("data-[size=sm]:h-7");
  });
});

describe("SelectContent popup width", () => {
  it("sizes the popup to its own content (w-max), not a fixed bind to the trigger's width", () => {
    renderSelect();
    fireEvent.click(document.querySelector('[role="combobox"]')!);

    const popup = document.querySelector('[data-slot="select-content"]');
    expect(popup).toBeInTheDocument();
    expect(popup).toHaveClass("w-max");
    expect(popup).not.toHaveClass("w-(--anchor-width)");
  });

  it("still floors the popup width at the trigger's own width, so it's never narrower than what it opens from", () => {
    renderSelect();
    fireEvent.click(document.querySelector('[role="combobox"]')!);

    const popup = document.querySelector('[data-slot="select-content"]');
    expect(popup).toHaveClass("min-w-(--anchor-width)");
    expect(popup).not.toHaveClass("min-w-36");
  });
});
