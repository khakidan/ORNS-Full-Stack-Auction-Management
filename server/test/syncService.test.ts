import { describe, it, expect } from "vitest";
import { computeBidderNumbersRows, ensureBidderNumbersSheet } from "../services/syncService";

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
    const fakeClient = {};
    await expect(ensureBidderNumbersSheet(fakeClient, "bm-id", "")).rejects.toThrow(/Auction Tickets spreadsheet ID/);
  });
});
