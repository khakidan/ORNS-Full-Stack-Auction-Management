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
import { createGate, waitUntilQueuedOnLock } from "./helpers/gate";

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
  // checkoutMarkPaid is already safe on its own (Code Hardening item #2,
  // Step 3: `checkoutMarkPaidLocked` finds its target row by scanning for
  // the bidder's own ID, not a computed "next open slot", and every
  // payment-method branch writes a specific final value) - it's wrapped
  // in the same withLock as registerWalkInBidder/recordWinningBid purely
  // as cheap insurance, so every bidder-mutating write path in this app
  // is protected by the same rule. This proves that wrapping is real:
  // bidder 42's Bidder-Numbers lookup is held open, and bidder 99's
  // checkout (same spreadsheet) must not even start its own lookup until
  // 42's has fully completed.
  it("does not start a second concurrent checkout's Bidder-Numbers lookup until the first one (same spreadsheet) has fully finished", async () => {
    const callOrder: string[] = [];
    const bidder42Gate = createGate();

    // Both bidders have no invoice URL (columns J/K blank), so the "cash"
    // branch never calls out to PayPalService at all - keeps this test
    // scoped to proving lock ordering, not PayPal request mocking.
    const bidderNumbersRows = [
      ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid", "Method", "InvoiceURL", "Amount", "Timestamp"],
      ["42", "Jane", "Doe", "jane@example.com", true, false, false, false, "", "", 0, ""],
      ["99", "Sam", "Roe", "sam@example.com", true, false, false, false, "", "", 0, ""],
    ];

    // Rows land on sheet rows 2 (bidder 42) and 3 (bidder 99), so the
    // write ranges (G2:I2 vs G3:I3) unambiguously identify which bidder's
    // flow reached its final write - markers are pushed from inside these
    // mocked calls themselves (not from a `.then()` on the outer
    // checkoutMarkPaid promise), since that extra promise-chain hop
    // resolves one microtask later than the lock's own release and would
    // otherwise make bidder 99's already-correctly-gated continuation
    // look like it started before bidder 42 "ended".
    let wideReadCount = 0;
    vi.mocked(google.sheets).mockReturnValue({
      spreadsheets: {
        values: {
          get: vi.fn(async ({ range }: any) => {
            if (range.includes("!A:L")) {
              wideReadCount++;
              const isFirst = wideReadCount === 1;
              callOrder.push(isFirst ? "42-start" : "99-start");
              if (isFirst) await bidder42Gate.wait();
            }
            return { data: { values: bidderNumbersRows.map((r) => [...r]) } };
          }),
          update: vi.fn(async ({ range }: any) => {
            if (range.includes("G2")) callOrder.push("42-end");
            else if (range.includes("G3")) callOrder.push("99-end");
            return { data: {} };
          }),
        },
      },
    } as any);

    const fakeAuth = {} as any;
    const checkout42 = checkoutMarkPaid(fakeAuth, {
      bidderId: "42", spreadsheetId: "same-bm-id", bidderNumbersSheet: "Bidder-Numbers", paymentMethod: "cash",
    });
    const checkout99 = checkoutMarkPaid(fakeAuth, {
      bidderId: "99", spreadsheetId: "same-bm-id", bidderNumbersSheet: "Bidder-Numbers", paymentMethod: "cash",
    });

    // Fired both without awaiting either yet. Release 42 only once it's
    // inside its Bidder-Numbers read and 99 is queued on the lock behind
    // it. Without the lock, 99 never queues, so this wait fails the test.
    await bidder42Gate.reached;
    await waitUntilQueuedOnLock("bidder-numbers:same-bm-id");
    bidder42Gate.release();

    const [result42, result99] = await Promise.all([checkout42, checkout99]);

    expect(result42.success).toBe(true);
    expect(result99.success).toBe(true);
    // With the lock: 99 can't even start its own lookup until 42 fully
    // finishes. Without it: 99 (ungated) would complete before 42's gate
    // is ever released.
    expect(callOrder).toEqual(["42-start", "42-end", "99-start", "99-end"]);
  });
});

describe("recordWinningBid - the range it reports", () => {
  it("quotes the tab name, so Undo can use the range as-is even when the tab name has a space", async () => {
    const grid = [["105", ""], ["Winner", "One"], ["Item #:", "Price:"]];
    const sheets = {
      spreadsheets: {
        get: async () => ({ data: { sheets: [{ properties: { title: "Follow-Up" } }] } }),
        values: {
          get: async ({ range }: { range: string }) => ({
            data: { values: range.startsWith("'Bid Management'") ? grid : range.startsWith("'Bidder Numbers'") ? [["ID"], ["105", "", "", "", true, false, false]] : [] },
          }),
          update: async () => ({ data: {} }),
          append: async ({ range }: any) => ({ data: { updates: { updatedRange: range } } }),
        },
      },
    } as any;

    const result = await recordWinningBid(sheets, {
      bidderId: "105", itemId: "301", price: 50, spreadsheetId: SPREADSHEET_ID,
      bidManagementSheet: "Bid Management", bidderNumbersSheet: "Bidder Numbers",
    });

    expect(result.range).toBe("'Bid Management'!A4:B4");
  });
});
