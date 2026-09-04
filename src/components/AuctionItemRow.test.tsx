/**
 * @vitest-environment jsdom
 *
 * Regression guard for the keyboard-focus-reveal gap flagged in
 * refactor-opportunities.md: the delete IconButton is hidden via
 * `opacity-0 group-hover/row:opacity-100`, which never reveals it for a
 * keyboard user tabbing to it without a mouse hovering the row -
 * component-standards.md requires focus outlines never be removed
 * without replacement. jsdom doesn't apply real CSS (no computed
 * opacity to read), so the only way to pin this fix here is asserting
 * the `group-focus-within/row:opacity-100` class itself is present
 * alongside the existing `group-hover/row:opacity-100`.
 */
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AuctionItemRow } from "./AuctionItemRow";
import { AuctionItem } from "@/types";

const ITEM: AuctionItem = {
  id: "item1",
  name: "Art Class",
  category: "Experiences",
  description: "A fun class",
  value: "$100.00",
  openingBid: "$20.00",
  minRaise: "$5.00",
  donor: "Jane Doe",
  itemType: "Physical Item",
  status: "Active",
  bundleId: "",
  bundledDateTime: "",
  rowIndex: 2,
};

function renderRow(overrides: Partial<ComponentProps<typeof AuctionItemRow>> = {}) {
  return render(
    <table>
      <tbody>
        <AuctionItemRow
          item={ITEM}
          isSelected={false}
          onToggleSelect={() => {}}
          onUpdate={() => {}}
          isAuctionClosed={false}
          categories={["Experiences"]}
          isExecutingRestore={false}
          restoreBundleId={null}
          onRestoreBundle={() => {}}
          onDeleteRequest={() => {}}
          {...overrides}
        />
      </tbody>
    </table>
  );
}

describe("AuctionItemRow - delete-button keyboard-focus reveal", () => {
  it("reveals the delete button on focus-within, not just hover", () => {
    renderRow();

    const deleteButton = screen.getByRole("button", { name: `Delete ${ITEM.name}` });
    expect(deleteButton.className).toContain("group-hover/row:opacity-100");
    expect(deleteButton.className).toContain("group-focus-within/row:opacity-100");
  });

  it("does not render the delete button once the auction is closed", () => {
    renderRow({ isAuctionClosed: true });

    expect(screen.queryByRole("button", { name: `Delete ${ITEM.name}` })).not.toBeInTheDocument();
  });
});
