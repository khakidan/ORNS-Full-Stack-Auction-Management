/**
 * Concurrency regression guard for registerWalkInBidder - the originally
 * reported bug in the "Concurrency Safety for Simultaneous Bidder
 * Operations" milestone (docs/agents/ROADMAP.md). The function computes
 * the next bidder ID (max existing ID + 1) and the next open
 * Bid-Management column pair from a fresh read, then writes to them. Two
 * walk-ins registered within the same read/write window - realistic the
 * moment more than one staff member works the door - could previously
 * compute the same ID/columns, with the second write silently clobbering
 * the first's data.
 *
 * Uses a hand-rolled fake Sheets client with genuinely shared, mutable
 * state (not per-call canned responses) so a real race can actually
 * manifest: without the withLock wrapper, two concurrent calls both read
 * the same "current max ID" before either has written, and both compute
 * the same new ID - this test would fail with that exact symptom if the
 * lock were removed (verified directly - see the fix's own commit
 * history/sanity-check discipline).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { registerWalkInBidder } from "../services/bidderService";

const SPREADSHEET_ID = "bm-spreadsheet-id";
const BIDDER_NUMBERS_SHEET = "Bidder-Numbers";
const BID_MANAGEMENT_SHEET = "Bid-Management";

/**
 * A minimal fake `sheets_v4.Sheets` with real shared mutable state for
 * Bidder-Numbers (an in-memory row array both concurrent calls read from
 * and append to) - deliberately not a per-call canned-response mock,
 * since the whole point is to let two calls actually observe each other's
 * writes (or fail to, without the lock).
 */
function makeFakeSheets() {
  const bidderNumbersRows: any[][] = [
    ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid"],
    [104, "Existing", "Bidder", "existing@example.com", true, false, false, false],
  ];
  const bidManagementWrites: { range: string; values: any[][] }[] = [];

  const fake = {
    spreadsheets: {
      get: async ({ spreadsheetId }: any) => ({
        data: {
          sheets: [
            { properties: { title: BIDDER_NUMBERS_SHEET, sheetId: 1, gridProperties: { columnCount: 26 } } },
            { properties: { title: BID_MANAGEMENT_SHEET, sheetId: 2, gridProperties: { columnCount: 26 } } },
          ],
        },
      }),
      batchUpdate: async () => ({ data: {} }),
      values: {
        get: async ({ range }: { range: string }) => {
          if (range.includes(BIDDER_NUMBERS_SHEET)) {
            return { data: { values: bidderNumbersRows.map((r) => [...r]) } };
          }
          if (range.includes(BID_MANAGEMENT_SHEET) && range.includes("1:5")) {
            // Width check: report a width matching however many walk-ins have already landed a column pair.
            const cols = 2 + bidManagementWrites.length * 2;
            return { data: { values: [new Array(cols).fill("x")] } };
          }
          // executeGoogleSheetsTransaction's staging reads (append sheet-exists check, update oldValues check).
          return { data: { values: [] } };
        },
        update: async ({ range, requestBody }: any) => {
          if (range.includes(BID_MANAGEMENT_SHEET)) {
            bidManagementWrites.push({ range, values: requestBody.values });
          }
          return { data: {} };
        },
        append: async ({ range, requestBody }: any) => {
          if (range.includes(BIDDER_NUMBERS_SHEET)) {
            bidderNumbersRows.push(...requestBody.values);
          }
          return { data: { updates: { updatedRange: range } } };
        },
      },
    },
  } as any;

  return { fake, bidderNumbersRows, bidManagementWrites };
}

describe("registerWalkInBidder - concurrency", () => {
  it("assigns two DIFFERENT bidder IDs (and two different Bid-Management column pairs) to two walk-ins registered concurrently", async () => {
    const { fake, bidderNumbersRows, bidManagementWrites } = makeFakeSheets();

    const [resultA, resultB] = await Promise.all([
      registerWalkInBidder(fake, {
        firstName: "Alice", lastName: "One", email: "alice@example.com",
        spreadsheetId: SPREADSHEET_ID, ticketPrice: 35,
        bidderNumbersSheet: BIDDER_NUMBERS_SHEET, bidManagementSheet: BID_MANAGEMENT_SHEET,
      }),
      registerWalkInBidder(fake, {
        firstName: "Bob", lastName: "Two", email: "bob@example.com",
        spreadsheetId: SPREADSHEET_ID, ticketPrice: 35,
        bidderNumbersSheet: BIDDER_NUMBERS_SHEET, bidManagementSheet: BID_MANAGEMENT_SHEET,
      }),
    ]);

    // The real, business-meaningful assertion: no duplicate ID.
    expect(resultA.bidder.id).not.toBe(resultB.bidder.id);
    expect([resultA.bidder.id, resultB.bidder.id].sort()).toEqual([105, 106]);

    // Bidder-Numbers must have exactly 2 new rows, one per walk-in - not
    // one overwriting the other, and not a duplicate ID landing twice.
    const newRows = bidderNumbersRows.slice(2);
    expect(newRows.map((r) => r[0]).sort()).toEqual([105, 106]);

    // Bid-Management must have written to two DIFFERENT column ranges, not the same one twice.
    expect(bidManagementWrites).toHaveLength(2);
    expect(bidManagementWrites[0].range).not.toBe(bidManagementWrites[1].range);
  });
});
