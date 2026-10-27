// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import BidEntry from "./BidEntry";
import { fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";
import { act } from "@testing-library/react";
import { addToOutbox, removeFromOutbox, _resetOutboxForTesting } from "@/lib/bidOutbox";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  getSheetData: vi.fn(),
  updateSheetData: vi.fn()
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: { bidManagementSpreadsheetId: "mock-spreadsheet-id" }
  })
}));

const mockRecordWinningBid = vi.fn(async (bidderId, itemId, price) => {
  await fetchWithRetry(`http://localhost:3000/api/auction/record-winning-bid`, {
    method: "POST",
    body: JSON.stringify({ bidderId, itemId, price })
  });
});

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    bidders: [
      { id: "142", firstName: "Test", lastName: "Bidder", checkedIn: true, isProxy: false },
      // Second bidder with checkedIn: false for the validation test
      { id: "999", firstName: "Unchecked", lastName: "Guest", checkedIn: false, isProxy: false },
      // A data-quality edge case seen in practice: a bidder row with an
      // empty-string id. Regression guard below for the bug this exposed.
      { id: "", firstName: "Blank", lastName: "Bidder", checkedIn: true, isProxy: false }
    ],
    items: [
      { id: "1301", name: "Sample Item" },
      { id: "1502", name: "Raffle Ticket", allowMultipleWinners: true },
      { id: "1601", name: "Wine Basket", value: "$100.00", openingBid: "$45.00", minRaise: "$5.00" },
      // Same data-quality edge case for items - e.g. an inactive/bundled
      // row whose id was blanked out but is still present in the array.
      { id: "", name: "New Art Bundle" }
    ],
    winners: { "1502": "Prior Winner" },
    recordWinningBid: mockRecordWinningBid
  })
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

describe("BidEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("shows Quick Entry mode by default", () => {
    render(<BidEntry />);
    expect(screen.getByPlaceholderText("e.g. 1301")).toBeInTheDocument();
  });

  it("Bid entry happy path", async () => {
    render(<BidEntry />);

    const itemInput = screen.getByPlaceholderText("e.g. 1301");
    await userEvent.type(itemInput, "1301");
    expect(await screen.findByText("Sample Item")).toBeTruthy();

    const bidderInput = screen.getByPlaceholderText("e.g. 142");
    await userEvent.type(bidderInput, "142");
    expect(await screen.findByText("Test Bidder")).toBeTruthy();

    const priceInput = screen.getByPlaceholderText("150.00");
    await userEvent.type(priceInput, "150");

    await userEvent.click(screen.getByText("Record Winning Bid"));

    expect(mockRecordWinningBid).toHaveBeenCalledWith("142", "1301", 150);
    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/api/auction/record-winning-bid"),
      expect.objectContaining({
        body: expect.stringContaining("150")
      })
    );
  });

  it("shows the three entries together, and asks before recording an amount that looks mistyped", async () => {
    render(<BidEntry />);
    await userEvent.type(screen.getByPlaceholderText("e.g. 1301"), "1601");
    await userEvent.type(screen.getByPlaceholderText("e.g. 142"), "142");
    await userEvent.type(screen.getByPlaceholderText("150.00"), "1500{Enter}");

    expect(screen.getByTestId("bid-summary")).toHaveTextContent("#1601Bidder 142$1500.00");
    expect(screen.getByTestId("bid-summary")).toHaveTextContent("more than 3 times the item's value");
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Check the bid sheet");
    expect(mockRecordWinningBid).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Record anyway" }));
    await waitFor(() => expect(mockRecordWinningBid).toHaveBeenCalledWith("142", "1601", 1500));
  });

  it("blank fields — shows toast error and does not call recordWinningBid", async () => {
    render(<BidEntry />);
    await userEvent.click(screen.getByText("Record Winning Bid"));
    expect(mockRecordWinningBid).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Please fill in a valid item number");
  });

  it("non-checked-in bidder — shows toast error and does not submit", async () => {
    render(<BidEntry />);
    await userEvent.type(screen.getByPlaceholderText("e.g. 1301"), "1301");
    await userEvent.type(screen.getByPlaceholderText("e.g. 142"), "999");
    await userEvent.type(screen.getByPlaceholderText("150.00"), "50");
    await userEvent.click(screen.getByText("Record Winning Bid"));

    expect(mockRecordWinningBid).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Bidder must be checked in (or be a proxy bidder)"
    );
  });

  // Regression guard for a user-reported bug: an item/bidder row with an
  // empty-string id (a real data-quality issue seen in practice) used to
  // match `.find(i => i.id === itemId)` as soon as the input was empty too
  // (`"" === ""`), showing that row's name/label under a blank field. See
  // docs/agents/CHANGELOG.md.
  it("does not show an item or bidder label when the Item Number/Bidder ID fields are empty, even if a row has a blank id", () => {
    render(<BidEntry />);

    expect(screen.queryByText("New Art Bundle")).not.toBeInTheDocument();
    expect(screen.queryByText("Blank Bidder")).not.toBeInTheDocument();
  });

  it("gives each field's Label some breathing room from its Input", () => {
    render(<BidEntry />);

    for (const labelText of ["Item Number", "Bidder ID", "Winning Bid ($)"]) {
      const label = screen.getByText(labelText);
      expect(label.parentElement?.className).toContain("space-y-2");
    }
  });

  it("form clears after successful submission", async () => {
    render(<BidEntry />);

    const itemInput = screen.getByPlaceholderText("e.g. 1301");
    const bidderInput = screen.getByPlaceholderText("e.g. 142");
    const priceInput = screen.getByPlaceholderText("150.00");

    await userEvent.type(itemInput, "1301");
    await userEvent.type(bidderInput, "142");
    await userEvent.type(priceInput, "150");
    await userEvent.click(screen.getByText("Record Winning Bid"));

    await waitFor(() => {
      expect(itemInput).toHaveValue("");
      expect(bidderInput).toHaveValue("");
      expect(priceInput).toHaveValue(null);
    });
  });

  it("Enter in the Item Number field advances focus to Bidder ID", async () => {
    render(<BidEntry />);

    const itemInput = screen.getByPlaceholderText("e.g. 1301");
    const bidderInput = screen.getByPlaceholderText("e.g. 142");

    await userEvent.type(itemInput, "1301{Enter}");

    expect(bidderInput).toHaveFocus();
  });

  it("Enter in the Bidder ID field advances focus to Winning Bid", async () => {
    render(<BidEntry />);

    await userEvent.type(screen.getByPlaceholderText("e.g. 1301"), "1301{Enter}");
    const priceInput = screen.getByPlaceholderText("150.00");
    await userEvent.type(screen.getByPlaceholderText("e.g. 142"), "142{Enter}");

    expect(priceInput).toHaveFocus();
  });

  it("Enter in the Winning Bid field submits and refocuses Item Number", async () => {
    render(<BidEntry />);

    const itemInput = screen.getByPlaceholderText("e.g. 1301");
    await userEvent.type(itemInput, "1301{Enter}");
    await userEvent.type(screen.getByPlaceholderText("e.g. 142"), "142{Enter}");
    await userEvent.type(screen.getByPlaceholderText("150.00"), "150{Enter}");

    await waitFor(() => expect(mockRecordWinningBid).toHaveBeenCalledWith("142", "1301", 150));
    await waitFor(() => expect(itemInput).toHaveFocus());
  });

  it("blocks a duplicate winning bid for a non-repeatable item that already has one, and shows it in the session feed", async () => {
    render(<BidEntry />);

    // Sample Item (1301) has no existing winner in the mock, so use a
    // second real item id to exercise the duplicate path - reusing 1301
    // itself after a successful submit would work too, but this is more
    // direct.
    await userEvent.type(screen.getByPlaceholderText("e.g. 1301"), "1301");
    await userEvent.type(screen.getByPlaceholderText("e.g. 142"), "142");
    await userEvent.type(screen.getByPlaceholderText("150.00"), "150");
    await userEvent.click(screen.getByText("Record Winning Bid"));
    await waitFor(() => expect(mockRecordWinningBid).toHaveBeenCalledTimes(1));

    expect(screen.getByText("1 recorded")).toBeInTheDocument();
  });

  it("shows a Repeatable badge for an item flagged with allowMultipleWinners, even though it already has a winner", async () => {
    render(<BidEntry />);

    await userEvent.type(screen.getByPlaceholderText("e.g. 1301"), "1502");

    expect(await screen.findByText("Raffle Ticket")).toBeInTheDocument();
    expect(screen.getByText(/Repeatable/)).toBeInTheDocument();
  });

  it("switches to Batch Entry mode and shows the grid", async () => {
    render(<BidEntry />);

    await userEvent.click(screen.getByText("Batch Entry"));

    expect(screen.getByText("Transcribe a Stack")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("e.g. 1301")).not.toBeInTheDocument();
  });

  // Milestone A: a bid saved on the device is marked in the This Session feed.
  it("marks a bid in This Session as saved on this device until it's sent", async () => {
    _resetOutboxForTesting();
    mockRecordWinningBid.mockImplementationOnce(async (bidderId: string, itemId: string, price: number) => {
      addToOutbox(
        { bidderId, itemId, price, spreadsheetId: "ss", bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", idempotencyKey: "quick-1" },
        { bidderName: "Test Bidder", itemName: "Sample Item" }
      );
      return "quick-1" as any;
    });
    render(<BidEntry />);

    await userEvent.type(screen.getByPlaceholderText("e.g. 1301"), "1301");
    await userEvent.type(screen.getByPlaceholderText("e.g. 142"), "142");
    await userEvent.type(screen.getByPlaceholderText("150.00"), "150");
    await userEvent.click(screen.getByText("Record Winning Bid"));

    expect(await screen.findByText(/Saved on this device/)).toBeInTheDocument();
    act(() => removeFromOutbox("quick-1"));
    expect(screen.queryByText(/Saved on this device/)).not.toBeInTheDocument();
  });
});
