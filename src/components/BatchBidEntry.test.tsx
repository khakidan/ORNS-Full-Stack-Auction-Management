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

describe("BatchBidEntry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders 3 starting rows and the Record Ready Bids button disabled at 0 ready", () => {
    renderGrid();
    expect(screen.getByTestId("batch-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("batch-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("batch-row-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record 0 Ready Bids/ })).toBeDisabled();
  });

  it("resolves a fully-filled row to its item/bidder names and enables the submit button", async () => {
    renderGrid();
    const row = screen.getByTestId("batch-row-0");
    const inputs = row.querySelectorAll("input");

    await userEvent.type(inputs[0], "1301");
    await userEvent.type(inputs[1], "142");
    await userEvent.type(inputs[2], "150");

    expect(await screen.findByText("Sample Item")).toBeInTheDocument();
    expect(screen.getByText(/Test Bidder/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record 1 Ready Bid/ })).not.toBeDisabled();
  });

  it("clicking Record Ready Bids calls recordWinningBid for the ready row", async () => {
    const recordWinningBid = vi.fn().mockResolvedValue(undefined);
    renderGrid({ recordWinningBid });
    const row = screen.getByTestId("batch-row-0");
    const inputs = row.querySelectorAll("input");

    await userEvent.type(inputs[0], "1301");
    await userEvent.type(inputs[1], "142");
    await userEvent.type(inputs[2], "150");
    await userEvent.click(screen.getByRole("button", { name: /Record 1 Ready Bid/ }));

    expect(recordWinningBid).toHaveBeenCalledWith("142", "1301", 150);
  });

  it("shows a duplicate warning for a non-repeatable item that already has a winner, and keeps the submit button disabled", async () => {
    renderGrid({ winners: { "1301": "Existing Winner" } });
    const row = screen.getByTestId("batch-row-0");
    const inputs = row.querySelectorAll("input");

    await userEvent.type(inputs[0], "1301");
    await userEvent.type(inputs[1], "142");
    await userEvent.type(inputs[2], "150");

    expect(await screen.findByText(/Already won by Existing Winner/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record 0 Ready Bids/ })).toBeDisabled();
  });

  it("shows a Repeatable badge, not a duplicate warning, for an item flagged allowMultipleWinners", async () => {
    renderGrid({
      items: [{ ...ITEM, allowMultipleWinners: true }],
      winners: { "1301": "Existing Winner" },
    });
    const row = screen.getByTestId("batch-row-0");
    const inputs = row.querySelectorAll("input");

    await userEvent.type(inputs[0], "1301");
    await userEvent.type(inputs[1], "142");
    await userEvent.type(inputs[2], "150");

    expect(await screen.findByText("repeatable")).toBeInTheDocument();
    expect(screen.queryByText(/Already won by/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record 1 Ready Bid/ })).not.toBeDisabled();
  });
});
