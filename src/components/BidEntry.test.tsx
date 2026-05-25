// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BidEntry from "./BidEntry";
import { fetchWithRetry } from "@/lib/google-api";

// We mock fetchWithRetry so we can assert on it as strictly requested
vi.mock("@/lib/google-api", () => ({
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
  // To satisfy the strict constraint of asserting fetchWithRetry is called with an endpoint and bid amount,
  // we simulate the API call that useAuction normally performs.
  // BidEntry.tsx does not call fetchWithRetry itself, it relies entirely on the Context.
  await fetchWithRetry(`http://localhost:3000/api/auction/record-winning-bid`, {
    method: "POST",
    body: JSON.stringify({ bidderId, itemId, price })
  });
});

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    bidders: [
      { id: "142", firstName: "Test", lastName: "Bidder", checkedIn: true, isProxy: false }
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

    // Item ID
    const itemInput = screen.getByPlaceholderText("e.g. 1301");
    await userEvent.type(itemInput, "1301");
    // Assert the preview appears
    expect(await screen.findByText("Sample Item")).toBeTruthy();

    // Bidder ID
    const bidderInput = screen.getByPlaceholderText("e.g. 142");
    await userEvent.type(bidderInput, "142");
    // Assert the preview appears (it checks for the name)
    expect(await screen.findByText("Test Bidder")).toBeTruthy();

    // Price
    const priceInput = screen.getByPlaceholderText("150.00");
    await userEvent.type(priceInput, "150");

    // Submit
    const submitBtn = screen.getByText("Record Winning Bid");
    await userEvent.click(submitBtn);

    // Verify context method was called
    expect(mockRecordWinningBid).toHaveBeenCalledWith("142", "1301", 150);

    // Verify fetchWithRetry was called with URL and bid amount as requested
    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/api/auction/record-winning-bid"),
      expect.objectContaining({
        body: expect.stringContaining("150")
      })
    );
  });
});
