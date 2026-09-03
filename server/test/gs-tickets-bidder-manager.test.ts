/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_BidderManager.gs's
 * `getAllBidders` - the logic that drives the printed bidder labels handed
 * out at the auction. This is a correctness-critical path: bidder numbers
 * are affixed to bidding guides BEFORE the auction starts, so a label
 * printed with the wrong number (or a number that doesn't correspond to
 * anyone in the app's real Bidder-Numbers sheet) means someone could
 * accidentally win an item they never intended to bid on.
 *
 * `getAllBidders` deliberately does NOT invent bidder numbers - it looks
 * every person up in the Bid-Management app's real "Bidder-Numbers" sheet
 * (the single source of truth also written by server/services/syncService.ts's
 * performSheetSync()), matching on a normalized first/last/email key that
 * must stay identical to that file's `formatName`/hash logic.
 *
 * Loaded via helpers/loadGasClass, not a Node reimplementation, so these
 * tests exercise the actual .gs source.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";
import { FakeSpreadsheet } from "./helpers/fakeSheet";

const { BidderManager } = loadGasClasses(
  [
    "scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_GlobalVariables.gs",
    "scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_Bidder.gs",
    "scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_BidderManager.gs",
  ],
  ["BidderManager"]
);

// Bidder-Numbers columns: ID, First Name, Last Name, Email, ...
const BIDDER_NUMBERS_HEADER = ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid", "Payment Method", "Invoice URL", "Invoiced Amount"];

function fakeBidManagementSpreadsheet(rows: any[][]) {
  const ss = new FakeSpreadsheet();
  ss.addSheet("Bidder-Numbers", [BIDDER_NUMBERS_HEADER, ...rows]);
  return ss;
}

function makeManager(ticketsRows: Record<string, any[][]>, bidderNumberRows: any[][]) {
  const spreadsheet = new FakeSpreadsheet();
  Object.entries(ticketsRows).forEach(([sheetName, rows]) => {
    // Header row required by getSheetData_ (skips row 1), content is arbitrary.
    spreadsheet.addSheet(sheetName, [["Header"], ...rows]);
  });
  return new BidderManager({
    activeSpreadSheet: spreadsheet,
    config: {},
    bidManagementSpreadsheet: fakeBidManagementSpreadsheet(bidderNumberRows),
  });
}

describe("BidderManager.getAllBidders", () => {
  it("throws when no bidManagementSpreadsheetId is given", () => {
    const mgr = makeManager({}, []);
    expect(() => mgr.getAllBidders()).toThrow(/requires a Bid-Management spreadsheet ID/);
  });

  it("throws when the Bidder-Numbers sheet has no data (sync hasn't run)", () => {
    const mgr = makeManager({ tickets: [["Alice", "One", "alice@example.com"]] }, []);
    expect(() => mgr.getAllBidders("bm-id")).toThrow(/Set Up Bid Management App/);
  });

  it("looks up the real number for a primary bidder instead of inventing one", () => {
    const mgr = makeManager(
      { tickets: [["Alice", "One", "alice@example.com"]] },
      [["205", "Alice", "One", "alice@example.com"]]
    );
    const bidders = mgr.getAllBidders("bm-id");
    expect(bidders).toHaveLength(1);
    expect(bidders[0].getNumber()).toBe("205");
    expect(bidders[0].getDisplayName()).toBe("Alice One");
  });

  it("matches case-insensitively and trims whitespace, mirroring syncService.ts's formatName", () => {
    const mgr = makeManager(
      { tickets: [["  ALICE  ", "one", "  ALICE@Example.com  "]] },
      [["205", "Alice", "One", "alice@example.com"]]
    );
    const bidders = mgr.getAllBidders("bm-id");
    expect(bidders).toHaveLength(1);
    expect(bidders[0].getNumber()).toBe("205");
  });

  it("throws a hard error naming any unmatched PRIMARY bidder", () => {
    const mgr = makeManager(
      { tickets: [["Alice", "One", "alice@example.com"], ["Ghost", "Person", "ghost@example.com"]] },
      [["205", "Alice", "One", "alice@example.com"]]
    );
    expect(() => mgr.getAllBidders("bm-id")).toThrow(/Ghost Person/);
  });

  it("silently skips an unmatched GUEST rather than throwing (not opting in is normal)", () => {
    // tickets row: primary(0,1,2), guest1(7,8,9), guest2(11,12,13), guest3(15,16,17)
    const row = new Array(18).fill("");
    row[0] = "Alice"; row[1] = "One"; row[2] = "alice@example.com";
    row[7] = "Bob"; row[8] = "Guest"; row[9] = "bob@example.com"; // not in Bidder-Numbers
    const mgr = makeManager(
      { tickets: [row] },
      [["205", "Alice", "One", "alice@example.com"]]
    );
    const bidders = mgr.getAllBidders("bm-id");
    expect(bidders).toHaveLength(1);
    expect(bidders[0].getDisplayName()).toBe("Alice One");
  });

  it("uses the CORRECTED guest column offsets for guest 2 and guest 3 (the original bug)", () => {
    const row = new Array(18).fill("");
    row[0] = "Alice"; row[1] = "One"; row[2] = "alice@example.com";
    row[11] = "Carol"; row[12] = "Guest2"; row[13] = "carol@example.com"; // guest 2
    row[15] = "Dave"; row[16] = "Guest3"; row[17] = "dave@example.com"; // guest 3
    const mgr = makeManager(
      { tickets: [row] },
      [
        ["205", "Alice", "One", "alice@example.com"],
        ["206", "Carol", "Guest2", "carol@example.com"],
        ["207", "Dave", "Guest3", "dave@example.com"],
      ]
    );
    const names = mgr.getAllBidders("bm-id").map((b: any) => b.getDisplayName());
    expect(names).toEqual(["Alice One", "Carol Guest2", "Dave Guest3"]);
  });

  it("does not exclude staff or sponsor guests, since they have none to begin with (row[7+] is undefined there)", () => {
    const mgr = makeManager(
      {
        "staff tickets": [["Staff", "Member", "staff@example.com"]],
        "sponsor tickets": [["Sponsor", "Person", "sponsor@example.com"]],
      },
      [
        ["101", "Staff", "Member", "staff@example.com"],
        ["102", "Sponsor", "Person", "sponsor@example.com"],
      ]
    );
    const names = mgr.getAllBidders("bm-id").map((b: any) => b.getDisplayName());
    expect(names).toEqual(["Staff Member", "Sponsor Person"]);
  });

  it("returns bidders sorted ascending by bidder number, not sheet-read order", () => {
    const mgr = makeManager(
      { tickets: [["Zed", "Last", "zed@example.com"], ["Amy", "First", "amy@example.com"]] },
      [
        ["310", "Zed", "Last", "zed@example.com"],
        ["105", "Amy", "First", "amy@example.com"],
      ]
    );
    const numbers = mgr.getAllBidders("bm-id").map((b: any) => b.getNumber());
    expect(numbers).toEqual(["105", "310"]);
  });
});
