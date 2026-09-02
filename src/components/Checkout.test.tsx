// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Checkout from "./Checkout";
import { fetchWithRetry, getBaseUrl, getSheetData } from "@/services/google-api";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
  getSheetData: vi.fn(),
  updateSheetData: vi.fn()
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: { 
      bidManagementSpreadsheetId: "mock-spreadsheet-id",
      receiptFolderId: "mock-folder-id",
      bidManagementSheet: "Bid-Management"
    }
  })
}));

const mockBidders = [
  { id: "101", firstName: "Jane", lastName: "Doe", email: "jane@test.com", checkedOut: false, paid: false },
  { id: "102", firstName: "John", lastName: "Smith", email: "john@test.com", checkedOut: false, paid: false }
];

const mockItems = [
  { id: "item1", name: "Art Class" },
  { id: "item2", name: "Pizza Party" }
];

vi.mock("@/context/AuctionContext", () => ({
  useAuction: () => ({
    bidders: mockBidders,
    items: mockItems,
    loading: false,
    fetchAllData: vi.fn(),
    attendees: []
  })
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}));

describe("Checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock special winners response (empty for happy path)
    vi.mocked(getSheetData).mockImplementation((spreadsheetId: string, range: string) => {
      if (range.startsWith("Special-Winners")) {
        return Promise.resolve({ values: [] });
      }
      // Mock the bid-management sheet response
      // Structure: First row is header, then data rows.
      // Format matches Checkout.tsx logic: header=[bidderId1, "", bidderId2, ""]
      // data row for item1: [itemId1, price1, itemId2, price2]
      if (range.includes("Bid-Management")) {
        return Promise.resolve({
          values: [
            ["101", "Info", "102", "Info"], // row 0: headers
            ["Header", "Details", "Header", "Details"], // row 1
            ["More", "Stuff", "More", "Stuff"], // row 2
            ["item1", "$50.00", "item2", "$75.00"] // row 3: winners values
          ]
        });
      }
      return Promise.resolve({ values: [] });
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("Renders bidder checkout information", async () => {
    render(<Checkout />);

    expect(await screen.findByText("Jane Doe")).toBeTruthy();
    expect(await screen.findByText("John Smith")).toBeTruthy();

    expect(screen.getByText("Art Class")).toBeTruthy();
    expect(screen.getAllByText("$50.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Pizza Party")).toBeTruthy();
    expect(screen.getAllByText("$75.00").length).toBeGreaterThan(0);
  });

  it("Print All Receipts button calls the correct endpoint", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({})
    } as Response);

    render(<Checkout />);
    await screen.findByText("Jane Doe");

    const btn = screen.getByText("Print All Receipts");
    await userEvent.click(btn);

    // Click "Yes, Print" in the confirm dialog
    const confirmBtn = await screen.findByText("Yes, Print");
    await userEvent.click(confirmBtn);

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/receipts/generate-all"),
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("Email All Winners button calls the correct endpoint", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({})
    } as Response);

    render(<Checkout />);
    await screen.findByText("Jane Doe");

    const btn = screen.getByText("Email All Winners");
    await userEvent.click(btn);

    // Click "Yes, Email" in the confirm dialog
    const confirmBtn = await screen.findByText("Yes, Email");
    await userEvent.click(confirmBtn);

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/receipts/email-all"),
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("Per-bidder receipt buttons", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({})
    } as Response);

    render(<Checkout />);
    await screen.findByText("Jane Doe");

    // Get Jane Doe's card by finding its title and traversing up to the card,
    // or just looking for the buttons within the specific parent.
    // Easiest is to target specific role or text, but we need row scoped. 
    // The name "Jane Doe" is an h3 inside a card. We can grab the card that contains "Jane Doe"
    const janeTitle = screen.getByText("Jane Doe");
    // WinnerCard root has "flex flex-col h-full shadow-sm" but no simple role.
    // We can use screen.getAllByText("Print Receipt")[0] if Jane is first.
    // Or we can find the closest element containing the specific bidder's UI.
    const allPrintBtns = screen.getAllByText("Print Receipt");
    const janePrintBtn = allPrintBtns[0]; // Since Jane is bidder 101, she should be first.

    await userEvent.click(janePrintBtn);

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/receipts/generate"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"bidderId":"101"')
      })
    );

    const allEmailBtns = screen.getAllByText("Email Receipt");
    const janeEmailBtn = allEmailBtns[0];
    
    await userEvent.click(janeEmailBtn);

    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/receipts/email-only"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"bidderId":"101"')
      })
    );
  });

  it("Empty state — no winners yet", async () => {
    // Override getSheetData to return empty values
    vi.mocked(getSheetData).mockImplementation(async () => ({ values: [] }));

    render(<Checkout />);

    expect(await screen.findByText("No winners found in this category.")).toBeTruthy();
    expect(screen.queryByText("Jane Doe")).toBeFalsy();
  });
});
