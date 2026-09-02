// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import BidEntry from "./BidEntry";
import { fetchWithRetry } from "@/services/google-api";
import { toast } from "sonner";

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
      { id: "999", firstName: "Unchecked", lastName: "Guest", checkedIn: false, isProxy: false }
    ],
    items: [
      { id: "1301", name: "Sample Item" }
    ],
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
});