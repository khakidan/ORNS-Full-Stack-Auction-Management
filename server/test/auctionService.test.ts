/**
 * Concurrency regression guard for recordWinningBid - found during the
 * "Concurrency Safety for Simultaneous Bidder Operations" audit
 * (docs/agents/ROADMAP.md), not the originally-reported bug. The function
 * finds the winning bidder's own column (safe, identity-based), then
 * scans down that column for the first empty row from a fresh read, then
 * writes to it. If the same bidder wins two items and two different staff
 * record them within the same read/write window - a normal, good outcome
 * at a live auction, not an edge case - both computations could land on
 * the same "first empty row," and the second recorded win would silently
 * overwrite the first: a lost winning-bid record, meaning a sold item
 * never gets invoiced.
 *
 * Uses a hand-rolled fake Sheets client with genuinely shared, mutable
 * Bid-Management grid state, so a real race can actually manifest (not a
 * per-call canned-response mock).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("googleapis", () => ({
  google: {
    script: vi.fn(),
    sheets: vi.fn(),
  },
}));

import { google } from "googleapis";
import { recordWinningBid, checkoutMarkPaid } from "../services/auctionService";

const SPREADSHEET_ID = "bm-spreadsheet-id";
const BIDDER_NUMBERS_SHEET = "Bidder-Numbers";
const BID_MANAGEMENT_SHEET = "Bid-Management";
const WINNING_BIDDER_ID = "105";

function makeFakeSheets() {
  // Bidder 105 in columns A/B, an unrelated bidder 106 in columns C/D.
  // Rows 0-2 are header/name/label rows (not scanned); row 3 (sheet row 4)
  // onward is the first available bid slot.
  const bidManagementGrid: any[][] = [
    [WINNING_BIDDER_ID, "", "106", ""],
    ["Winner", "One", "Other", "Two"],
    ["Item #:", "Price:", "Item #:", "Price:"],
  ];
  const bidderNumbersRows: any[][] = [
    ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out"],
    [WINNING_BIDDER_ID, "Winner", "One", "winner@example.com", true, false, false],
  ];

  const fake = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { title: "Follow-Up" } }] } }),
      batchUpdate: async () => ({ data: {} }),
      values: {
        get: async ({ range }: { range: string }) => {
          if (range.includes(BIDDER_NUMBERS_SHEET)) {
            return { data: { values: bidderNumbersRows.map((r) => [...r]) } };
          }
          if (range.includes(BID_MANAGEMENT_SHEET)) {
            return { data: { values: bidManagementGrid.map((r) => [...r]) } };
          }
          return { data: { values: [] } };
        },
        update: async ({ range, requestBody }: any) => {
          // range looks like "Bid-Management!A4:B4" - parse the row/col
          // back out so writes land in the same shared grid reads see.
          const match = range.match(/!([A-Z]+)(\d+):([A-Z]+)(\d+)/);
          if (match && range.includes(BID_MANAGEMENT_SHEET)) {
            const colLetterToIndex = (letters: string) =>
              [...letters].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
            const startCol = colLetterToIndex(match[1]);
            const rowIdx = parseInt(match[2], 10) - 1; // 0-indexed
            while (bidManagementGrid.length <= rowIdx) bidManagementGrid.push([]);
            requestBody.values[0].forEach((v: any, i: number) => {
              bidManagementGrid[rowIdx][startCol + i] = v;
            });
          }
          return { data: {} };
        },
        append: async ({ range, requestBody }: any) => {
          if (range.includes("Follow-Up")) return { data: { updates: { updatedRange: range } } };
          return { data: { updates: { updatedRange: range } } };
        },
      },
    },
  } as any;

  return { fake, bidManagementGrid };
}

describe("recordWinningBid - concurrency", () => {
  it("records two DIFFERENT items won by the SAME bidder in two DIFFERENT rows, when recorded concurrently by different staff", async () => {
    const { fake, bidManagementGrid } = makeFakeSheets();

    const [resultA, resultB] = await Promise.all([
      recordWinningBid(fake, {
        bidderId: WINNING_BIDDER_ID, itemId: "801", price: 50,
        spreadsheetId: SPREADSHEET_ID, bidManagementSheet: BID_MANAGEMENT_SHEET, bidderNumbersSheet: BIDDER_NUMBERS_SHEET,
      }),
      recordWinningBid(fake, {
        bidderId: WINNING_BIDDER_ID, itemId: "803", price: 75,
        spreadsheetId: SPREADSHEET_ID, bidManagementSheet: BID_MANAGEMENT_SHEET, bidderNumbersSheet: BIDDER_NUMBERS_SHEET,
      }),
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    // Both winning bids must be present in bidder 105's column (0/1) -
    // neither one silently overwritten by the other.
    const bidderColumnPairs: string[] = [];
    for (let i = 3; i < bidManagementGrid.length; i++) {
      const row = bidManagementGrid[i];
      if (row && row[0]) bidderColumnPairs.push(`${row[0]}:${row[1]}`);
    }
    expect(bidderColumnPairs.sort()).toEqual(["801:50", "803:75"]);
  });
});

describe("checkoutMarkPaid - concurrency (defense-in-depth)", () => {
  // checkoutMarkPaid is already safe on its own (Class_GoogleAIStudio.gs's
  // recordPayment finds its target row by scanning for the bidder's own
  // ID, not a computed "next open slot", and every payment-method branch
  // writes a specific final value) - it's wrapped in the same withLock as
  // registerWalkInBidder/recordWinningBid purely as cheap insurance, so
  // every bidder-mutating write path in this app is protected by the same
  // rule. This proves that wrapping is real: bidder 42's Apps Script call
  // is held open, and bidder 99's checkout (same spreadsheet) must not
  // even start its own Apps Script call until 42's has fully completed.
  beforeEach(() => {
    process.env.SCRIPT_ID_BID_MANAGEMENT = "dummy-script-id";
  });

  it("does not start a second concurrent checkout's Apps Script call until the first one (same spreadsheet) has fully finished", async () => {
    const callOrder: string[] = [];
    let releaseBidder42: () => void;
    const bidder42Gate = new Promise<void>((resolve) => { releaseBidder42 = resolve; });

    vi.mocked(google.script).mockReturnValue({
      scripts: {
        run: vi.fn(async ({ requestBody }: any) => {
          const bidderId = requestBody.parameters[0];
          callOrder.push(`${bidderId}-start`);
          if (bidderId === "42") {
            await bidder42Gate;
          }
          callOrder.push(`${bidderId}-end`);
          return { data: { response: { result: { success: true, deferred: false, bidderId } } } };
        }),
      },
    } as any);

    const fakeAuth = {} as any;
    const checkout42 = checkoutMarkPaid(fakeAuth, {
      bidderId: "42", spreadsheetId: "same-bm-id", bidderNumbersSheet: "Bidder-Numbers", paymentMethod: "cash",
    });
    const checkout99 = checkoutMarkPaid(fakeAuth, {
      bidderId: "99", spreadsheetId: "same-bm-id", bidderNumbersSheet: "Bidder-Numbers", paymentMethod: "cash",
    });

    // Fired both without awaiting either yet. Without the lock, bidder 99
    // (never gated) would race ahead and finish well before bidder 42's
    // gate is released below. Give both a moment to actually reach the
    // mocked Apps Script call, then release 42.
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseBidder42!();

    const [result42, result99] = await Promise.all([checkout42, checkout99]);

    expect(result42.success).toBe(true);
    expect(result99.success).toBe(true);
    // With the lock: 99 can't even start until 42 fully finishes. Without
    // it: 99 (ungated) would complete before 42's gate is ever released.
    expect(callOrder).toEqual(["42-start", "42-end", "99-start", "99-end"]);
  });
});
