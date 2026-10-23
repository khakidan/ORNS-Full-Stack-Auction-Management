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
import { registerWalkInBidder, checkInBidderWithBid, setBidderFlag } from "../services/bidderService";
import { withLock } from "../utils/asyncLock";

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

describe("checkInBidderWithBid - concurrency (defense-in-depth)", () => {
  // checkInBidderWithBid does the exact same "scan the bidder's own
  // Bid-Management column for the first empty row from a fresh read,
  // then write to it" pattern recordWinningBid/registerWalkInBidder are
  // wrapped in withLock for - two staff checking in bidders around the
  // same time (e.g. two check-in stations, or two staff processing the
  // same physical ticket at nearly the same moment) is a realistic risk
  // this closes. Found in a hardening audit - see
  // docs/agents/CHANGELOG.md's Code Hardening item #1 /
  // CHANGELOG.md. Mirrors auctionService.test.ts's checkoutMarkPaid
  // concurrency test: gate the first call's initial wide read, prove the
  // second call's own read doesn't even start until the first fully
  // finishes.
  it("does not start a second concurrent check-in's Bid-Management read until the first one (same spreadsheet) has fully finished", async () => {
    const callOrder: string[] = [];
    let releaseFirst: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    // Row 0: header pairs for bidders 201 (cols 0/1) and 202 (cols 2/3).
    // Rows 1-2 are name/label rows (not scanned); row 3 onward is the
    // first available bid slot for each bidder's own column.
    const bidManagementGrid: any[][] = [
      ["201", "", "202", ""],
      ["Winner", "One", "Other", "Two"],
      ["Item #:", "Price:", "Item #:", "Price:"],
    ];
    const bidderNumbersRows: any[][] = [
      ["ID", "First Name", "Last Name", "Email", "Checked In"],
      ["201", "Jane", "Doe", "jane@example.com", false],
      ["202", "Sam", "Roe", "sam@example.com", false],
    ];

    let wideReadCount = 0;
    const fake = {
      spreadsheets: {
        values: {
          get: async ({ range }: { range: string }) => {
            if (range.includes("Bid-Management") && range.includes("1:300")) {
              wideReadCount++;
              const isFirst = wideReadCount === 1;
              callOrder.push(isFirst ? "201-start" : "202-start");
              if (isFirst) await firstGate;
              return { data: { values: bidManagementGrid.map((r) => [...r]) } };
            }
            if (range.includes("Bidder-Numbers")) {
              return { data: { values: bidderNumbersRows.map((r) => [...r]) } };
            }
            return { data: { values: [] } };
          },
          update: async ({ range }: { range: string }) => {
            // The Bidder-Numbers "mark checked-in" write is always the
            // LAST op executeGoogleSheetsTransaction applies for a given
            // check-in - the reliable point to mark "fully finished" at,
            // keyed by which bidder's own row (E2 vs E3) it targets.
            if (range.includes("Bidder-Numbers")) {
              callOrder.push(range.includes("E2") ? "201-end" : "202-end");
            }
            return { data: {} };
          },
        },
      },
    } as any;

    const checkIn201 = checkInBidderWithBid(fake, {
      bidderId: "201", spreadsheetId: "same-bm-id", bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", bidValue: 35,
    });
    const checkIn202 = checkInBidderWithBid(fake, {
      bidderId: "202", spreadsheetId: "same-bm-id", bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", bidValue: 35,
    });

    // Fired both without awaiting either yet. Give both a moment to
    // actually reach the mocked Bid-Management read, then release 201.
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseFirst!();

    const [result201, result202] = await Promise.all([checkIn201, checkIn202]);

    expect(result201.success).toBe(true);
    expect(result202.success).toBe(true);
    // With the lock: 202 can't even start its own read until 201 fully
    // finishes. Without it: 202 (ungated) would complete before 201's
    // gate is ever released.
    expect(callOrder).toEqual(["201-start", "201-end", "202-start", "202-end"]);
  });
});

describe("setBidderFlag", () => {
  function fakeSheets(ids: string[]) {
    const writes: { range: string; values: any[][] }[] = [];
    const sheets = {
      spreadsheets: {
        values: {
          get: async () => ({ data: { values: [["ID"], ...ids.map((id) => [id])] } }),
          update: async ({ range, requestBody }: any) => {
            writes.push({ range, values: requestBody.values });
            return { data: {} };
          },
        },
      },
    } as any;
    return { sheets, writes };
  }

  it("ticks Checked In (column E) on the bidder's own row", async () => {
    const { sheets, writes } = fakeSheets(["101", "102"]);
    await setBidderFlag(sheets, { spreadsheetId: SPREADSHEET_ID, bidderNumbersSheet: BIDDER_NUMBERS_SHEET, bidderId: "102", flag: "checkedIn" });
    expect(writes).toEqual([{ range: "'Bidder-Numbers'!E3", values: [[true]] }]);
  });

  it("ticks Proxy Bidder (column F)", async () => {
    const { sheets, writes } = fakeSheets(["101"]);
    await setBidderFlag(sheets, { spreadsheetId: SPREADSHEET_ID, bidderNumbersSheet: BIDDER_NUMBERS_SHEET, bidderId: "101", flag: "isProxy" });
    expect(writes).toEqual([{ range: "'Bidder-Numbers'!F2", values: [[true]] }]);
  });

  it("writes nothing and says so when the bidder isn't in the sheet", async () => {
    const { sheets, writes } = fakeSheets(["101"]);
    await expect(
      setBidderFlag(sheets, { spreadsheetId: SPREADSHEET_ID, bidderNumbersSheet: BIDDER_NUMBERS_SHEET, bidderId: "999", flag: "checkedIn" })
    ).rejects.toThrow("Bidder 999 not found in Bidder-Numbers");
    expect(writes).toHaveLength(0);
  });

  it("waits for the bidder-numbers lock, so it can't interleave with a walk-in registration on the same sheet", async () => {
    const order: string[] = [];
    let release: () => void;
    const held = withLock(`bidder-numbers:${SPREADSHEET_ID}`, async () => {
      order.push("other-writer-start");
      await new Promise<void>((resolve) => { release = resolve; });
      order.push("other-writer-end");
    });
    const { sheets } = fakeSheets(["101"]);
    const flag = setBidderFlag(sheets, { spreadsheetId: SPREADSHEET_ID, bidderNumbersSheet: BIDDER_NUMBERS_SHEET, bidderId: "101", flag: "checkedIn" })
      .then(() => order.push("set-flag-done"));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["other-writer-start"]);
    release!();
    await Promise.all([held, flag]);
    expect(order).toEqual(["other-writer-start", "other-writer-end", "set-flag-done"]);
  });
});
