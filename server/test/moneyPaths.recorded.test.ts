/**
 * Records every Sheets call the money-path writers make in their main
 * scenarios (ROADMAP.md R11), so they can be restructured without changing
 * what they read or write. The fake keeps no state between calls: each
 * read returns the fixture for its range.
 */
import { describe, it, expect } from "vitest";
import { registerWalkInBidder, checkInBidderWithBid } from "../services/bidderService";
import { recordWinningBid } from "../services/auctionService";
import { WinningBidConflictError } from "../utils/winningBidChecks";

type Fixture = Record<string, any[][]>;

function fakeSheets(ranges: Fixture, tabs: { title: string; sheetId: number; columnCount?: number }[]) {
  const calls: any[] = [];
  const sheets = {
    spreadsheets: {
      get: async ({ spreadsheetId }: any) => {
        calls.push(["get-meta", spreadsheetId]);
        return { data: { sheets: tabs.map((t) => ({ properties: { title: t.title, sheetId: t.sheetId, gridProperties: { columnCount: t.columnCount ?? 26 } } })) } };
      },
      batchUpdate: async ({ spreadsheetId, requestBody }: any) => {
        calls.push(["batchUpdate", spreadsheetId, requestBody.requests]);
        return { data: {} };
      },
      values: {
        get: async ({ spreadsheetId, range }: any) => {
          calls.push(["get", spreadsheetId, range]);
          return { data: { values: ranges[range] ?? [] } };
        },
        update: async ({ spreadsheetId, range, requestBody }: any) => {
          calls.push(["update", spreadsheetId, range, requestBody.values]);
          return { data: {} };
        },
        append: async ({ spreadsheetId, range, requestBody }: any) => {
          calls.push(["append", spreadsheetId, range, requestBody.values]);
          return { data: {} };
        },
      },
    },
  } as any;
  return { sheets, calls };
}

const BID_GRID = [
  ["101", "", "102", ""],
  ["Ann", "Lee", "Bo", "Ray"],
  ["Item #:", "Price:", "Item #:", "Price:"],
  ["801", "50", "", ""],
  ["", "", "", ""],
];
const BIDDERS = [
  ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out"],
  ["101", "Ann", "Lee", "ann@x.org", "TRUE", "FALSE", "FALSE"],
  ["102", "Bo", "Ray", "bo@x.org", "TRUE", "FALSE", "TRUE"],
];
const TABS = [{ title: "Bidder-Numbers", sheetId: 1 }, { title: "Bid-Management", sheetId: 2, columnCount: 6 }];

describe("recordWinningBid - recorded calls", () => {
  const base = { spreadsheetId: "bm", bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers" };

  it("writes the bid in the bidder's first empty row", async () => {
    const { sheets, calls } = fakeSheets({ "'Bidder-Numbers'!A:G": BIDDERS, "'Bid-Management'!1:300": BID_GRID }, TABS);
    await expect(recordWinningBid(sheets, { ...base, bidderId: "101", itemId: "802", price: 75 })).resolves.toEqual({ success: true, followUpAdded: false, range: "'Bid-Management'!A5:B5" });
    expect(calls).toMatchSnapshot();
  });

  it("also creates the Follow-Up tab and adds a row for a bidder who already checked out", async () => {
    const { sheets, calls } = fakeSheets({ "'Bidder-Numbers'!A:G": BIDDERS, "'Bid-Management'!1:300": BID_GRID }, TABS);
    await expect(recordWinningBid(sheets, { ...base, bidderId: "102", itemId: "803", price: 20 })).resolves.toEqual({ success: true, followUpAdded: true, range: "'Bid-Management'!C4:D4" });
    expect(calls).toMatchSnapshot();
  });

  it("reports an already-recorded resend without writing it again", async () => {
    const items = [["Item Number", "Category", "Item Name"], ["801", "Food", "Pizza"]];
    const { sheets, calls } = fakeSheets({ "'Bidder-Numbers'!A:G": BIDDERS, "'Bid-Management'!1:300": BID_GRID, "'Auction-Items'!A:M": items }, TABS);
    await expect(recordWinningBid(sheets, { ...base, bidderId: "101", itemId: "801", price: 50, itemsSpreadsheetId: "items" }))
      .resolves.toEqual({ success: true, followUpAdded: false, alreadyRecorded: true });
    expect(calls.filter((c) => c[0] !== "get")).toEqual([]);
  });

  it("refuses a second winner for a one-winner item, writing nothing", async () => {
    const items = [["Item Number", "Category", "Item Name"], ["801", "Food", "Pizza"]];
    const { sheets, calls } = fakeSheets({ "'Bidder-Numbers'!A:G": BIDDERS, "'Bid-Management'!1:300": BID_GRID, "'Auction-Items'!A:M": items }, TABS);
    await expect(recordWinningBid(sheets, { ...base, bidderId: "102", itemId: "801", price: 60, itemsSpreadsheetId: "items" }))
      .rejects.toBeInstanceOf(WinningBidConflictError);
    expect(calls.filter((c) => c[0] !== "get")).toEqual([]);
  });

  it("refuses an unknown bidder", async () => {
    const { sheets } = fakeSheets({ "'Bidder-Numbers'!A:G": BIDDERS, "'Bid-Management'!1:300": BID_GRID }, TABS);
    await expect(recordWinningBid(sheets, { ...base, bidderId: "999", itemId: "802", price: 5 })).rejects.toThrow("Bidder 999 not found.");
  });
});

describe("checkInBidderWithBid - recorded calls", () => {
  it("adds the ticket bid in the bidder's first empty row and ticks Checked In", async () => {
    const { sheets, calls } = fakeSheets({ "'Bid-Management'!1:300": BID_GRID, "'Bidder-Numbers'!A:A": BIDDERS.map((r) => [r[0]]) }, TABS);
    await expect(checkInBidderWithBid(sheets, { spreadsheetId: "bm", bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", bidderId: "102", bidValue: 40 }))
      .resolves.toEqual({ success: true, bidAdded: true, checkedIn: true });
    expect(calls).toMatchSnapshot();
  });
});

describe("registerWalkInBidder - recorded calls", () => {
  it("adds the bidder, their grid columns (growing the grid), formatting, and the ticket row", async () => {
    const { sheets, calls } = fakeSheets({
      "'Bidder-Numbers'!A:A": BIDDERS.map((r) => [r[0]]),
      "'Bid-Management'!1:5": BID_GRID,
    }, [...TABS, { title: "tickets", sheetId: 3 }]);
    const result = await registerWalkInBidder(sheets, {
      firstName: "dee", lastName: "MOORE", email: " dee@x.org ", spreadsheetId: "bm", ticketsSpreadsheetId: "tix",
      ticketPrice: 40, bidderNumbersSheet: "Bidder-Numbers", bidManagementSheet: "Bid-Management",
    });
    expect(result).toEqual({ success: true, bidder: { id: 103, firstName: "Dee", lastName: "Moore", email: "dee@x.org" }, ticketAppended: true, appendError: null });
    expect(calls).toMatchSnapshot();
  });

  it("without a tickets spreadsheet, skips the ticket row", async () => {
    const { sheets, calls } = fakeSheets({
      "'Bidder-Numbers'!A:A": BIDDERS.map((r) => [r[0]]),
      "'Bid-Management'!1:5": BID_GRID,
    }, TABS.map((t) => ({ ...t, columnCount: 40 })));
    const result = await registerWalkInBidder(sheets, {
      firstName: "Al", lastName: "Fox", spreadsheetId: "bm", bidderNumbersSheet: "Bidder-Numbers", bidManagementSheet: "Bid-Management",
    });
    expect(result.ticketAppended).toBe(false);
    expect(calls).toMatchSnapshot();
  });
});
