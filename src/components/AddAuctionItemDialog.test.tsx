/**
 * @vitest-environment jsdom
 *
 * `@/components/ui/select` is mocked here (matching
 * EditAuctionItemDialog.test.tsx/BundlingDialog.test.tsx's convention)
 * since the real base-ui Select needs jsdom stubs this file doesn't set up.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AddAuctionItemDialog } from "./AddAuctionItemDialog";
import { AuctionItem } from "@/types";

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)} data-testid="mock-select">
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

function renderDialog(newItem: Partial<AuctionItem> = {}, overrides: Partial<Parameters<typeof AddAuctionItemDialog>[0]> = {}) {
  const onNewItemChange = vi.fn();
  const onSubmit = vi.fn();
  render(
    <AddAuctionItemDialog
      open={true}
      onOpenChange={() => {}}
      categories={["Food", "Decor"]}
      newItem={newItem}
      onNewItemChange={onNewItemChange}
      onSubmit={onSubmit}
      isSubmitting={false}
      {...overrides}
    />
  );
  return { onNewItemChange, onSubmit };
}

describe("AddAuctionItemDialog - Allow Multiple Winners", () => {
  it("defaults the checkbox to unchecked, matching every non-standard item", () => {
    renderDialog({});
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("reflects a true value already present on newItem", () => {
    renderDialog({ allowMultipleWinners: true });
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("checking the box calls onNewItemChange with allowMultipleWinners: true, preserving other fields", async () => {
    const user = userEvent.setup();
    const { onNewItemChange } = renderDialog({ name: "Raffle Ticket", category: "Food" });

    await user.click(screen.getByRole("checkbox"));

    expect(onNewItemChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Raffle Ticket", category: "Food", allowMultipleWinners: true })
    );
  });
});

describe("AddAuctionItemDialog - shared layout with EditAuctionItemDialog", () => {
  it("groups fields into the same section headers Edit uses (Details / Pricing / Donor & Type)", () => {
    renderDialog({});
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText("Donor & Type")).toBeInTheDocument();
  });

  it("keeps only the Add-specific fields - no Item #, Opening Bid, or Min Raise inputs (those are server-calculated on save)", () => {
    renderDialog({});
    expect(screen.queryByText("Item #")).not.toBeInTheDocument();
    expect(screen.queryByText("Opening Bid")).not.toBeInTheDocument();
    expect(screen.queryByText("Min Raise")).not.toBeInTheDocument();
  });
});
