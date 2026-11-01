/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import CloseOutReportPage from "./CloseOutReportPage";

vi.mock("@/services/google-api", () => ({
  getSheetData: vi.fn(),
}));
import { getSheetData } from "@/services/google-api";
const mockedGetSheetData = vi.mocked(getSheetData);

const bidder = (id: string, firstName: string, over: Record<string, unknown> = {}) => ({
  id, firstName, lastName: "Lane", email: `${firstName.toLowerCase()}@example.com`,
  checkedIn: true, isProxy: false, checkedOut: true, paid: true, paymentMethod: "Cash", rowIndex: 2, ...over,
});

const auction = {
  bidders: [
    bidder("14", "Priya", { checkedOut: false, paid: false, paymentMethod: "" }),
    bidder("23", "Tom", { checkedOut: false }),
    bidder("47", "Nadia"),
    bidder("6", "Alan", { checkedIn: false, paid: false, paymentMethod: "" }),
  ],
  items: [
    { id: "101", category: "Food & Dining", name: "Family Pizza Night", rowIndex: 2 },
    { id: "1301", category: "Live Auction", name: "Lake House Weekend", rowIndex: 3 },
    { id: "120", category: "Retail", name: "Spa basket", rowIndex: 4 },
  ],
  bidGridWins: [
    { bidderId: "14", itemId: "1301", price: 1150 },
    { bidderId: "47", itemId: "101", price: 240 },
  ],
  winners: { "1301": "Priya Lane", "101": "Nadia Lane" },
  totalRaised: 1390,
  isAuctionClosed: true,
  loading: false,
  dataVersion: 0,
};

vi.mock("@/context/AuctionContext", () => ({ useAuction: () => auction }));
vi.mock("@/context/ConfigContext", () => ({ useConfig: () => ({ config: { bidManagementSpreadsheetId: "bm-sheet" } }) }));

/**
 * The visible report. Every block is also rendered once off-screen to be
 * measured; jsdom measures nothing, so the report stays on one sheet.
 */
const report = async () => within(await screen.findByRole("region", { name: "Page 1 of 1" }));

describe("CloseOutReportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSheetData.mockImplementation(async (_id: string, range: string) => {
      if (range === "Follow-Up!A:C") return { values: [["Bidder", "Item", "Due"], ["47", "101", "240"]] };
      if (range === "Special-Winners!A2:B3") return { values: [["$500 Amazon Gift Card", "47"], ["50/50 Raffle", ""]] };
      return { values: [] };
    });
  });

  it("reads the Follow-Up and Special-Winners tabs of this year's Bid Management sheet", async () => {
    render(<CloseOutReportPage />);
    await report();
    expect(mockedGetSheetData.mock.calls.map(([id, range]) => [id, range]).sort()).toEqual([
      ["bm-sheet", "Follow-Up!A:C"],
      ["bm-sheet", "Special-Winners!A2:B3"],
    ]);
  });

  it("lists who still has to check out, with what an unpaid bidder owes", async () => {
    render(<CloseOutReportPage />);
    const page = await report();
    const priya = page.getByText("Priya Lane").closest(".co-task") as HTMLElement;
    expect(priya).toHaveTextContent("#14");
    expect(priya).toHaveTextContent("$1,150.00 due");
    expect(priya).toHaveTextContent("Unpaid");
    const tom = page.getByText("Tom Lane").closest(".co-task") as HTMLElement;
    expect(tom).toHaveTextContent("Paid");
    expect(page.getByText("2 bidders · $1,150 unpaid")).toBeInTheDocument();
  });

  it("names a post-checkout win's item and the special winners", async () => {
    render(<CloseOutReportPage />);
    const page = await report();
    expect(page.getByText("Won: Family Pizza Night")).toBeInTheDocument();
    const gift = page.getByText("$500 Amazon Gift Card").closest(".co-prize") as HTMLElement;
    expect(within(gift).getByText("Nadia Lane")).toBeInTheDocument();
    const raffle = page.getByText("50/50 Raffle").closest(".co-prize") as HTMLElement;
    expect(raffle).toHaveTextContent("No winner recorded on the Dashboard.");
  });

  it("puts the unsold items in the wrap-up checklist and asks for every sign-off", async () => {
    render(<CloseOutReportPage />);
    const page = await report();
    expect(page.getByText("120 · Spa basket")).toBeInTheDocument();
    for (const label of ["Director", "Auction chair", "Application administrator", "Date closed out"]) {
      expect(page.getByText(label)).toBeInTheDocument();
    }
  });

  it("opens the browser's print dialog from Print / Save as PDF", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<CloseOutReportPage />);
    await report();
    await userEvent.click(screen.getByRole("button", { name: /Print \/ Save as PDF/ }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.title).toBe(`ORNS Auction Close-Out ${new Date().getFullYear()}`);
  });
});
