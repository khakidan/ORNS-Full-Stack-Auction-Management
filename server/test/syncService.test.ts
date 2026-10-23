import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeBidderNumbersRows, ensureBidderNumbersSheet, performSheetSync } from "../services/syncService";

// Column layout matches attendeeParsing.ts/syncService.ts's own: 0 first,
// 1 last, 2 email, 3-6 unused here, 7/8/9 guest 1, 10 guest 1 own-number
// flag, 11/12/13 guest 2, 14 guest 2 own-flag, 15/16/17 guest 3, 18 guest
// 3 own-flag.
function ticketRow(overrides: Record<number, any> = {}) {
  const row = new Array(19).fill("");
  Object.entries(overrides).forEach(([i, v]) => { row[Number(i)] = v; });
  return row;
}

describe("computeBidderNumbersRows", () => {
  it("assigns sequential IDs starting at 101, in order: staff, ticket primaries, then every guest-1, guest-2, guest-3, then sponsors", () => {
    const staffRows = [["Header"], ["Staff", "Member", "staff@example.com"]];
    const ticketsRows = [
      ["Header"],
      ticketRow({ 0: "Alice", 1: "One", 2: "alice@example.com", 7: "Bob", 8: "G1", 9: "bob@example.com", 10: "yes", 11: "Carol", 12: "G2", 13: "carol@example.com", 14: "yes" }),
    ];
    const sponsorRows = [["Header"], ["Sponsor", "Person", "sponsor@example.com"]];

    const rows = computeBidderNumbersRows(staffRows, ticketsRows, sponsorRows);

    expect(rows.map((r) => `${r[0]}: ${r[1]} ${r[2]}`)).toEqual([
      "101: Staff Member",
      "102: Alice One",
      "103: Bob G1",
      "104: Carol G2",
      "105: Sponsor Person",
    ]);
  });

  it("matches the user's exact reported row: 1 primary, 3 guests, 2 opted in and 1 not", () => {
    const ticketsRows = [
      ["Header"],
      ticketRow({
        0: "Dan", 1: "Sage", 2: "dan@example.com",
        7: "Jimmy", 8: "Smith", 9: "smith@smith.com", 10: "yes",
        11: "Amy", 12: "Sedaris", 13: "sedaris@gmail.com", 14: "yes",
        15: "Hue", 16: "Tint", 17: "afdhkj@gjlkadfs.com", 18: "no",
      }),
    ];

    const rows = computeBidderNumbersRows([["Header"]], ticketsRows, [["Header"]]);

    expect(rows.map((r) => `${r[1]} ${r[2]}`)).toEqual(["Dan Sage", "Jimmy Smith", "Amy Sedaris"]);
  });

  it("excludes a guest with no name, and a guest with a real name who did not opt in", () => {
    const ticketsRows = [
      ["Header"],
      ticketRow({ 0: "Alice", 1: "One", 10: "yes" }), // guest-1 name blank, stray "yes"
      ticketRow({ 0: "Bob", 1: "Two", 7: "Carol", 8: "Guest", 9: "carol@example.com", 10: "no" }), // opted out
    ];

    const rows = computeBidderNumbersRows([["Header"]], ticketsRows, [["Header"]]);

    expect(rows.map((r) => `${r[1]} ${r[2]}`)).toEqual(["Alice One", "Bob Two"]);
  });

  it("dedupes identical name+email pairs (case/whitespace-insensitive), keeping only the first ID assigned", () => {
    const staffRows = [["Header"], [" alice ", " one ", " ALICE@EXAMPLE.COM "]];
    const ticketsRows = [["Header"], ticketRow({ 0: "Alice", 1: "One", 2: "alice@example.com" })];

    const rows = computeBidderNumbersRows(staffRows, ticketsRows, [["Header"]]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([101, "Alice", "One", "alice@example.com", false, false, false, false, "", "", ""]);
  });

  it("formats names as capitalized-first/lowercased-rest and emails as lowercased/trimmed, matching syncService.ts's own formatName", () => {
    const staffRows = [["Header"], ["ALICE", "oNE", "  Alice@Example.COM  "]];

    const rows = computeBidderNumbersRows(staffRows, [["Header"]], [["Header"]]);

    expect(rows[0]).toEqual([101, "Alice", "One", "alice@example.com", false, false, false, false, "", "", ""]);
  });
});

describe("ensureBidderNumbersSheet", () => {
  it("throws a real, actionable error when the Auction Tickets spreadsheet ID is missing", async () => {
    const fakeSheets = {} as any;
    await expect(ensureBidderNumbersSheet(fakeSheets, "bm-id", "")).rejects.toThrow(/Auction Tickets spreadsheet ID/);
  });
});

/**
 * Records every Sheets call a full "Set Up Bid Management App" sync makes,
 * so the function can be restructured without changing what it writes.
 */
describe("performSheetSync - full rebuild", () => {
  function fakeSheets(opts: { walkIn?: boolean } = {}) {
    const calls: { op: string; args: any }[] = [];
    let tabs = [
      { properties: { title: "Bid-Management", sheetId: 1 } },
      { properties: { title: "Bidder-Numbers", sheetId: 2 } },
      { properties: { title: "_Settings", sheetId: 3 } },
    ];
    const ranges: Record<string, any[][]> = {
      "_Settings!A:C": [["Setting Key", "Value"], ["auctionTicketSheetsID", "tickets-id"], ["ticketPrice", "40"]],
      "'tickets'!A:T": [["First"], ["Pat", "Lee", "pat@x.org", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", opts.walkIn ? "Auction Checkout" : ""]],
      "'tickets'!A:S": [["First"], ["Pat", "Lee", "pat@x.org", "2", "yes", "", "", "Sam", "Lee", "sam@x.org", "yes"]],
      "'staff tickets'!A:C": [["First"], ["Ann", "Staff", "ann@orns.org"]],
      "'sponsor tickets'!A:C": [["First"]],
    };
    const sheets = {
      spreadsheets: {
        get: async () => ({ data: { sheets: tabs } }),
        batchUpdate: async ({ requestBody }: any) => {
          calls.push({ op: "batchUpdate", args: requestBody.requests });
          let nextId = 10;
          for (const r of requestBody.requests) {
            if (r.updateSheetProperties?.properties?.title) {
              tabs = tabs.map((t) => t.properties.sheetId === r.updateSheetProperties.properties.sheetId
                ? { properties: { ...t.properties, title: r.updateSheetProperties.properties.title } } : t);
            }
            if (r.addSheet) tabs = [...tabs, { properties: { title: r.addSheet.properties.title, sheetId: nextId++ } }];
          }
          return { data: {} };
        },
        values: {
          get: async ({ spreadsheetId, range }: any) => {
            calls.push({ op: "get", args: `${spreadsheetId} ${range}` });
            return { data: { values: ranges[range] || [] } };
          },
          update: async ({ range, requestBody }: any) => {
            calls.push({ op: "update", args: { range, values: requestBody.values } });
            return { data: {} };
          },
        },
      },
    } as any;
    return { sheets, calls };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 24, 9, 5, 7));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("archives the old tabs, then writes Bidder-Numbers and the Bid-Management grid", async () => {
    const { sheets, calls } = fakeSheets();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(performSheetSync(sheets, "bm-id")).resolves.toEqual({ success: true });

    expect(calls).toMatchSnapshot();
  });

  it("refuses to rebuild once a walk-in is registered, before changing anything", async () => {
    const { sheets, calls } = fakeSheets({ walkIn: true });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(performSheetSync(sheets, "bm-id")).rejects.toThrow(/Cannot re-sync: 1 walk-in bidder\(s\).*Pat Lee/);
    expect(calls.filter((c) => c.op !== "get")).toEqual([]);
  });
});
