import { describe, it, expect } from "vitest";
import { parseAttendeeRows } from "./attendeeParsing";

// General "tickets" sheet column layout (0-indexed), cross-checked against
// every other consumer of this exact layout so these tests pin verified,
// cross-file-consistent behavior rather than just whatever this file
// currently happens to do:
//   - server/services/syncService.ts's collectGuestInfo(7,8,9,10) /
//     (11,12,13,14) / (15,16,17,18)
//   - src/lib/attendeeSheetColumns.ts's paymentColumnsForSheet
//     (paymentStatus col U = index 20 for "tickets", R = index 17 otherwise)
//   - server/services/bidderService.ts's registerWalkInBidder Step F
//     (paymentMethod=19, paymentStatus=20, totalPaid=21)
//   - src/hooks/useTicketAttendeeState.ts's updateField guest-email columns
//     (J/N/R = 9/13/17 for "tickets", J/M/P = 9/12/15 otherwise)
// Full column map (0-indexed): A firstName, B lastName, C email, D phone,
// E ticketsPurchased, F hasGuests, G guest-marker checkbox (not read by
// this parser), H/I/J guest1 (first/last/email), K "own bidder number"
// flag (general sheet only - this is what shifts everything after it by
// one column vs. staff/sponsor), L/M/N guest2, O guest2-own-flag, P/Q/R
// guest3, S guest3-own-flag, T paymentMethod, U paymentStatus, V totalPaid
// (T/U/V only meaningful on the general sheet).
const GENERAL_HEADER = ["Header"];
const OTHER_HEADER = ["Header"];

function generalRow(overrides: Record<number, any> = {}) {
  const row = new Array(22).fill("");
  Object.entries(overrides).forEach(([i, v]) => { row[Number(i)] = v; });
  return row;
}

function otherRow(overrides: Record<number, any> = {}) {
  const row = new Array(19).fill("");
  Object.entries(overrides).forEach(([i, v]) => { row[Number(i)] = v; });
  return row;
}

describe("parseAttendeeRows - primary attendee fields", () => {
  it("extracts firstName/lastName/email/phone/ticketsPurchased/hasGuests from the same columns (0-5) regardless of sheet", () => {
    const row = generalRow({ 0: "Alice", 1: "One", 2: "alice@example.com", 3: "555-0100", 4: "2", 5: "yes" });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.firstName).toBe("Alice");
    expect(attendee.lastName).toBe("One");
    expect(attendee.email).toBe("alice@example.com");
    expect(attendee.phone).toBe("555-0100");
    expect(attendee.ticketsPurchased).toBe("2");
    expect(attendee.hasGuests).toBe("yes");
  });

  it("sets id/sheet/rowIndex correctly, accounting for the header row and 1-based sheet rows", () => {
    const rows = [GENERAL_HEADER, generalRow({ 0: "Alice", 1: "One" }), generalRow({ 0: "Bob", 1: "Two" })];
    const attendees = parseAttendeeRows("tickets", rows);

    expect(attendees[0]).toMatchObject({ id: "tickets-0", sheet: "tickets", rowIndex: 2 });
    expect(attendees[1]).toMatchObject({ id: "tickets-1", sheet: "tickets", rowIndex: 3 });
  });

  it("defaults ticketsPurchased to '0' when blank, but leaves other blank fields as ''", () => {
    const row = generalRow({ 0: "Alice", 1: "One" });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.ticketsPurchased).toBe("0");
    expect(attendee.email).toBe("");
    expect(attendee.phone).toBe("");
    expect(attendee.hasGuests).toBe("");
  });

  it("drops a row with no firstName and no lastName", () => {
    const rows = [
      GENERAL_HEADER,
      generalRow({ 0: "Alice", 1: "One" }),
      generalRow({ 2: "orphan@example.com" }), // email with no name - dropped
      generalRow(),
    ];
    const attendees = parseAttendeeRows("tickets", rows);

    expect(attendees).toHaveLength(1);
    expect(attendees[0].firstName).toBe("Alice");
  });

  it("keeps a row with only a firstName or only a lastName", () => {
    const rows = [GENERAL_HEADER, generalRow({ 0: "Alice" }), generalRow({ 1: "OnlyLast" })];
    const attendees = parseAttendeeRows("tickets", rows);

    expect(attendees).toHaveLength(2);
  });
});

describe("parseAttendeeRows - guest 1 (unshifted on every sheet)", () => {
  it("includes guest 1 on the general 'tickets' sheet, reading its own-bidder-number flag from column K (index 10)", () => {
    const row = generalRow({ 0: "Alice", 1: "One", 7: "Bob", 8: "Guest", 9: "bob@example.com", 10: "yes" });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.guestsInfo).toEqual([
      { name: "Bob Guest", firstName: "Bob", lastName: "Guest", email: "bob@example.com", guestIndex: 1, ownBidderNumber: "yes" },
    ]);
  });

  it("includes guest 1 on staff/sponsor sheets too, at the same columns, but with an empty ownBidderNumber (no flag column there)", () => {
    const row = otherRow({ 0: "Staff", 1: "Member", 7: "Bob", 8: "Guest", 9: "bob@example.com" });
    const [attendee] = parseAttendeeRows("staff tickets", [OTHER_HEADER, row]);

    expect(attendee.guestsInfo).toEqual([
      { name: "Bob Guest", firstName: "Bob", lastName: "Guest", email: "bob@example.com", guestIndex: 1, ownBidderNumber: "" },
    ]);
  });

  it("excludes guest 1 when its first/last/email columns are all blank", () => {
    const row = generalRow({ 0: "Alice", 1: "One" });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.guestsInfo).toEqual([]);
  });

  it("includes guest 1 even with only an email and no name (permissive - doesn't drop partial guest data)", () => {
    const row = generalRow({ 0: "Alice", 1: "One", 9: "onlyemail@example.com" });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.guestsInfo).toEqual([
      { name: "", firstName: "", lastName: "", email: "onlyemail@example.com", guestIndex: 1, ownBidderNumber: "" },
    ]);
  });
});

describe("parseAttendeeRows - guest 2/3 column shift (the exact bug pattern already fixed in TicketsSpreadsheet/Class_BidderManager.gs)", () => {
  it("reads guest 2 from the SHIFTED columns (11/12/13, own-flag 14) on the general 'tickets' sheet", () => {
    const row = generalRow({ 0: "Alice", 1: "One", 11: "Carol", 12: "Guest2", 13: "carol@example.com", 14: "no" });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.guestsInfo).toEqual([
      { name: "Carol Guest2", firstName: "Carol", lastName: "Guest2", email: "carol@example.com", guestIndex: 2, ownBidderNumber: "no" },
    ]);
  });

  it("reads guest 3 from the SHIFTED columns (15/16/17, own-flag 18) on the general 'tickets' sheet", () => {
    const row = generalRow({ 0: "Alice", 1: "One", 15: "Dave", 16: "Guest3", 17: "dave@example.com", 18: "yes" });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.guestsInfo).toEqual([
      { name: "Dave Guest3", firstName: "Dave", lastName: "Guest3", email: "dave@example.com", guestIndex: 3, ownBidderNumber: "yes" },
    ]);
  });

  it("reads guest 2 from the UNSHIFTED columns (10/11/12) on staff/sponsor sheets, one column earlier than the general sheet", () => {
    const row = otherRow({ 0: "Sponsor", 1: "Person", 10: "Carol", 11: "Guest2", 12: "carol@example.com" });
    const [attendee] = parseAttendeeRows("sponsor tickets", [OTHER_HEADER, row]);

    expect(attendee.guestsInfo).toEqual([
      { name: "Carol Guest2", firstName: "Carol", lastName: "Guest2", email: "carol@example.com", guestIndex: 2, ownBidderNumber: "" },
    ]);
  });

  it("reads guest 3 from the UNSHIFTED columns (13/14/15) on staff/sponsor sheets, one column earlier than the general sheet", () => {
    const row = otherRow({ 0: "Sponsor", 1: "Person", 13: "Dave", 14: "Guest3", 15: "dave@example.com" });
    const [attendee] = parseAttendeeRows("sponsor tickets", [OTHER_HEADER, row]);

    expect(attendee.guestsInfo).toEqual([
      { name: "Dave Guest3", firstName: "Dave", lastName: "Guest3", email: "dave@example.com", guestIndex: 3, ownBidderNumber: "" },
    ]);
  });

  it("collects all three guests together, in order, when every slot is filled on the general sheet", () => {
    const row = generalRow({
      0: "Alice", 1: "One",
      7: "Bob", 8: "G1", 9: "bob@example.com",
      11: "Carol", 12: "G2", 13: "carol@example.com",
      15: "Dave", 16: "G3", 17: "dave@example.com",
    });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.guestsInfo.map(g => g.guestIndex)).toEqual([1, 2, 3]);
    expect(attendee.guestsInfo.map(g => g.name)).toEqual(["Bob G1", "Carol G2", "Dave G3"]);
  });
});

describe("parseAttendeeRows - payment fields", () => {
  it("reads paymentMethod/paymentStatus/totalPaid from columns T/U/V (19/20/21) on the general 'tickets' sheet", () => {
    const row = generalRow({ 0: "Alice", 1: "One", 19: "Manual", 20: "Pending", 21: "$35" });
    const [attendee] = parseAttendeeRows("tickets", [GENERAL_HEADER, row]);

    expect(attendee.paymentMethod).toBe("Manual");
    expect(attendee.paymentStatus).toBe("Pending");
    expect(attendee.totalPaid).toBe("$35");
  });

  it("hardcodes paymentMethod/paymentStatus/totalPaid to Comp/Paid/$0 on staff/sponsor sheets, ignoring whatever is actually in those row slots", () => {
    // Staff and sponsors get free tickets - their sheets don't carry real
    // payment data, so the parser deliberately doesn't trust column
    // contents there (unlike the general sheet).
    const row = otherRow({ 0: "Staff", 1: "Member", 16: "should be ignored", 17: "should be ignored", 18: "should be ignored" });
    const [attendee] = parseAttendeeRows("staff tickets", [OTHER_HEADER, row]);

    expect(attendee.paymentMethod).toBe("Comp");
    expect(attendee.paymentStatus).toBe("Paid");
    expect(attendee.totalPaid).toBe("$0");
  });

  it("treats 'sponsor tickets' the same as 'staff tickets' for payment hardcoding (only 'tickets' is the general sheet)", () => {
    const row = otherRow({ 0: "Sponsor", 1: "Person" });
    const [attendee] = parseAttendeeRows("sponsor tickets", [OTHER_HEADER, row]);

    expect(attendee.paymentMethod).toBe("Comp");
    expect(attendee.paymentStatus).toBe("Paid");
    expect(attendee.totalPaid).toBe("$0");
  });
});
