/**
 * @vitest-environment jsdom
 *
 * Rewritten for the row-based redesign (see CHANGELOG.md's
 * "UI / Layout Tweaks" item and CHANGELOG.md) - AuctionItemRow.tsx is no
 * longer a <table> row, so this no longer wraps it in <table>/<tbody>,
 * and the old per-field EditableCell inline editors are gone in favor of
 * a single "Edit" icon opening EditAuctionItemDialog.tsx (tested
 * separately). The keyboard-focus-reveal regression guard from the
 * original version of this file is preserved, just re-scoped: the
 * hover/focus-reveal classes now live on the shared actions wrapper
 * (matching AttendeeRow.tsx/BidderRow.tsx's convention), not on each
 * button individually.
 */
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
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
    <AuctionItemRow
      item={ITEM}
      isSelected={false}
      onToggleSelect={() => {}}
      onEditRequest={() => {}}
      isAuctionClosed={false}
      isExecutingRestore={false}
      restoreBundleId={null}
      onRestoreBundle={() => {}}
      onDeleteRequest={() => {}}
      {...overrides}
    />
  );
}

describe("AuctionItemRow - action-button keyboard-focus reveal", () => {
  it("reveals the Edit/Delete buttons on focus-within, not just hover", () => {
    renderRow();

    const deleteButton = screen.getByRole("button", { name: `Delete ${ITEM.name}` });
    const actionsWrapper = deleteButton.parentElement;
    expect(actionsWrapper?.className).toContain("group-hover/row:opacity-100");
    expect(actionsWrapper?.className).toContain("group-focus-within/row:opacity-100");
  });

  it("does not render Edit/Delete buttons once the auction is closed", () => {
    renderRow({ isAuctionClosed: true });

    expect(screen.queryByRole("button", { name: `Delete ${ITEM.name}` })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Edit ${ITEM.name}` })).not.toBeInTheDocument();
  });
});

describe("AuctionItemRow - editing", () => {
  it("opens the edit dialog for this item when the Edit button is clicked", () => {
    const onEditRequest = vi.fn();
    renderRow({ onEditRequest });

    screen.getByRole("button", { name: `Edit ${ITEM.name}` }).click();

    expect(onEditRequest).toHaveBeenCalledWith(ITEM);
  });
});

describe("AuctionItemRow - selection", () => {
  it("calls onToggleSelect with this item's rowIndex when the checkbox is clicked", () => {
    const onToggleSelect = vi.fn();
    renderRow({ onToggleSelect });

    screen.getByRole("checkbox").click();

    expect(onToggleSelect).toHaveBeenCalledWith(ITEM.rowIndex);
  });
});

describe("AuctionItemRow - bundle restore", () => {
  it("shows the Restore Items button for a bundled Active item, and calls onRestoreBundle with the bundle token", () => {
    const onRestoreBundle = vi.fn();
    renderRow({ item: { ...ITEM, bundleId: "BND-1", status: "Active" }, onRestoreBundle });

    screen.getByRole("button", { name: /restore items/i }).click();
    expect(onRestoreBundle).toHaveBeenCalledWith("BND-1");
  });

  it("hides the Restore Items button once the auction is closed", () => {
    renderRow({ item: { ...ITEM, bundleId: "BND-1", status: "Active" }, isAuctionClosed: true });
    expect(screen.queryByRole("button", { name: /restore items/i })).not.toBeInTheDocument();
  });
});

describe("AuctionItemRow - description", () => {
  // jsdom has no layout, so truncation can't be measured; a line-clamp or
  // truncate class is what cuts a description off in the browser.
  it("shows the whole description, never clamped or truncated", () => {
    const description = "Line one of a long description. ".repeat(20) + "THE END";
    renderRow({ item: { ...ITEM, description } });

    const el = screen.getByText(/THE END$/);
    expect(el.textContent).toBe(description);
    expect(el.className).not.toMatch(/line-clamp|truncate|overflow-hidden/);
  });
});
