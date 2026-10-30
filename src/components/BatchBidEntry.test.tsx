// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { BatchBidEntry } from "./BatchBidEntry";
import { AuctionItem, Bidder } from "@/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const ITEM: AuctionItem = {
  id: "1301", name: "Sample Item", category: "", description: "", value: "", openingBid: "",
  minRaise: "", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "",
  rowIndex: 2,
};

const BIDDER: Bidder = {
  id: "142", firstName: "Test", lastName: "Bidder", email: "", checkedIn: true, isProxy: false,
  checkedOut: false, paid: false, rowIndex: 2,
};

function renderGrid(overrides: Partial<React.ComponentProps<typeof BatchBidEntry>> = {}) {
  return render(
    <BatchBidEntry
      items={[ITEM]}
      bidders={[BIDDER]}
      winners={{}}
      recordWinningBid={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />
  );
}

async function fillRow(n: number, itemId: string, bidderId: string, price: string) {
  await userEvent.type(screen.getByRole("textbox", { name: `Row ${n} item number` }), itemId);
  await userEvent.type(screen.getByRole("textbox", { name: `Row ${n} bidder number` }), bidderId);
  await userEvent.type(screen.getByRole("spinbutton", { name: `Row ${n} price` }), price);
}

describe("BatchBidEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders 3 starting rows and the Record Ready Bids button disabled at 0 ready", () => {
    renderGrid();
    expect(screen.getByRole("textbox", { name: "Row 1 item number" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Row 2 item number" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Row 3 item number" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Row 4 item number" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record 0 Ready Bids/ })).toBeDisabled();
  });

  it("resolves a fully-filled row to its item/bidder names and enables the submit button", async () => {
    renderGrid();
    await fillRow(1, "1301", "142", "150");

    expect(await screen.findByText("Sample Item")).toBeInTheDocument();
    expect(screen.getByText(/Test Bidder/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record 1 Ready Bid/ })).not.toBeDisabled();
  });

  it("clicking Record Ready Bids calls recordWinningBid for the ready row", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue(undefined);
    renderGrid({ recordWinningBid });
    await fillRow(1, "1301", "142", "150");
    await userEvent.click(screen.getByRole("button", { name: /Record 1 Ready Bid/ }));

    expect(recordWinningBid).toHaveBeenCalledWith("142", "1301", 150);
  });

  it("shows a duplicate warning for a non-repeatable item that already has a winner, and keeps the submit button disabled", async () => {
    renderGrid({ winners: { "1301": "Existing Winner" } });
    await fillRow(1, "1301", "142", "150");

    expect(await screen.findByText(/Already won by Existing Winner/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record 0 Ready Bids/ })).toBeDisabled();
  });

  it("shows a Repeatable badge, not a duplicate warning, for an item flagged allowMultipleWinners", async () => {
    renderGrid({
      items: [{ ...ITEM, allowMultipleWinners: true }],
      winners: { "1301": "Existing Winner" },
    });
    await fillRow(1, "1301", "142", "150");

    expect(await screen.findByText("repeatable")).toBeInTheDocument();
    expect(screen.queryByText(/Already won by/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record 1 Ready Bid/ })).not.toBeDisabled();
  });
});
