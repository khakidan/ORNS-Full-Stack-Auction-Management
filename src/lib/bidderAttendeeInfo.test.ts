import { describe, it, expect } from "vitest";
import { getBidderAttendeeInfo } from "./bidderAttendeeInfo";
import { Bidder, Attendee, Guest } from "@/types";

function makeBidder(overrides: Partial<Bidder> = {}): Bidder {
  return {
    id: "101",
    firstName: "Alice",
    lastName: "One",
    email: "alice@example.com",
    checkedIn: false,
    isProxy: false,
    checkedOut: false,
    paid: false,
    rowIndex: 2,
    ...overrides,
  };
}

function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    name: "Bob Guest",
    firstName: "Bob",
    lastName: "Guest",
    email: "bob@example.com",
    guestIndex: 1,
    ownBidderNumber: "",
    ...overrides,
  };
}

function makeAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    id: "tickets-0",
    sheet: "tickets",
    rowIndex: 2,
    firstName: "Carol",
    lastName: "Primary",
    email: "carol@example.com",
    phone: "",
    ticketsPurchased: "1",
    hasGuests: "",
    guestsInfo: [],
    paymentMethod: "Manual",
    paymentStatus: "Pending",
    totalPaid: "$0",
    ...overrides,
  };
}

describe("getBidderAttendeeInfo - primary match", () => {
  it("matches a bidder to the attendee with the same first/last name", () => {
    const bidder = makeBidder({ firstName: "Carol", lastName: "Primary" });
    const attendee = makeAttendee({ firstName: "Carol", lastName: "Primary" });

    expect(getBidderAttendeeInfo(bidder, [attendee])).toEqual({ attendee, isGuest: false });
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    const bidder = makeBidder({ firstName: "  CAROL  ", lastName: "primary" });
    const attendee = makeAttendee({ firstName: "Carol", lastName: "Primary" });

    expect(getBidderAttendeeInfo(bidder, [attendee])).toEqual({ attendee, isGuest: false });
  });

  it("returns undefined/not-a-guest when no attendee or guest matches at all", () => {
    const bidder = makeBidder({ firstName: "Nobody", lastName: "Here" });
    const attendee = makeAttendee({ firstName: "Carol", lastName: "Primary" });

    expect(getBidderAttendeeInfo(bidder, [attendee])).toEqual({ attendee: undefined, isGuest: false });
  });

  it("prefers a primary match over a guest match when a bidder happens to match both", () => {
    const bidder = makeBidder({ firstName: "Carol", lastName: "Primary", email: "carol@example.com" });
    const primaryAttendee = makeAttendee({ firstName: "Carol", lastName: "Primary" });
    const guestHost = makeAttendee({
      id: "tickets-1",
      firstName: "Dave",
      lastName: "Host",
      guestsInfo: [makeGuest({ name: "Carol Primary", email: "carol@example.com" })],
    });

    const result = getBidderAttendeeInfo(bidder, [guestHost, primaryAttendee]);
    expect(result).toEqual({ attendee: primaryAttendee, isGuest: false });
  });
});

describe("getBidderAttendeeInfo - guest match by email (the real fix)", () => {
  it("matches a guest by email even when the guest's on-file name doesn't match the bidder's real name", () => {
    // Simulates a nickname/typo mismatch (e.g. guest sheet says "Rob" but
    // the bidder's real name on file is "Robert") - name-only matching
    // would miss this; email doesn't.
    const bidder = makeBidder({ firstName: "Robert", lastName: "Smith", email: "rob@example.com" });
    const host = makeAttendee({
      firstName: "Dave",
      lastName: "Host",
      guestsInfo: [makeGuest({ name: "Rob Smith", email: "rob@example.com" })],
    });

    expect(getBidderAttendeeInfo(bidder, [host])).toEqual({ attendee: host, isGuest: true });
  });

  it("matches case-insensitively and ignores whitespace in email", () => {
    const bidder = makeBidder({ email: "  ROB@Example.com  " });
    const host = makeAttendee({
      guestsInfo: [makeGuest({ name: "Someone Else", email: "rob@example.com" })],
    });

    expect(getBidderAttendeeInfo(bidder, [host])).toEqual({ attendee: host, isGuest: true });
  });

  it("does not crash and falls through to name matching when the bidder has no email", () => {
    const bidder = makeBidder({ firstName: "Bob", lastName: "Guest", email: "" });
    const host = makeAttendee({
      guestsInfo: [makeGuest({ name: "Bob Guest", email: "bob@example.com" })],
    });

    expect(getBidderAttendeeInfo(bidder, [host])).toEqual({ attendee: host, isGuest: true });
  });

  it("does not crash when a guest record has no email on file", () => {
    const bidder = makeBidder({ email: "alice@example.com" });
    const host = makeAttendee({
      guestsInfo: [makeGuest({ name: "Someone Else", email: "" })],
    });

    expect(getBidderAttendeeInfo(bidder, [host])).toEqual({ attendee: undefined, isGuest: false });
  });
});

describe("getBidderAttendeeInfo - guest match by name (fallback)", () => {
  it("matches a guest by full name when there is no email overlap", () => {
    const bidder = makeBidder({ firstName: "Bob", lastName: "Guest", email: "different@example.com" });
    const host = makeAttendee({
      guestsInfo: [makeGuest({ name: "Bob Guest", email: "bob-on-file@example.com" })],
    });

    expect(getBidderAttendeeInfo(bidder, [host])).toEqual({ attendee: host, isGuest: true });
  });

  it("matches guest names case-insensitively", () => {
    const bidder = makeBidder({ firstName: "BOB", lastName: "guest", email: "" });
    const host = makeAttendee({
      guestsInfo: [makeGuest({ name: "Bob Guest", email: "" })],
    });

    expect(getBidderAttendeeInfo(bidder, [host])).toEqual({ attendee: host, isGuest: true });
  });
});

describe("getBidderAttendeeInfo - the dead ownBidderNumber field never causes a false match", () => {
  it("does not match on ownBidderNumber even when it happens to equal the bidder's id as a string", () => {
    // ownBidderNumber really holds the sheet's "yes"/"no" opt-in flag, not
    // a bidder ID - this pins that a coincidental string equality (e.g. a
    // bidder id of "1" against a stray guest flag value) can't produce a
    // false-positive match on its own, only real name/email overlap can.
    const bidder = makeBidder({ id: "1", firstName: "Zed", lastName: "Nomatch", email: "zed@example.com" });
    const host = makeAttendee({
      guestsInfo: [makeGuest({ name: "Someone Else", email: "someone@example.com", ownBidderNumber: "1" })],
    });

    expect(getBidderAttendeeInfo(bidder, [host])).toEqual({ attendee: undefined, isGuest: false });
  });
});

describe("getBidderAttendeeInfo - multiple guests and attendees", () => {
  it("finds the right host attendee when the matching guest is not the first one on the row", () => {
    const bidder = makeBidder({ firstName: "Third", lastName: "Guest", email: "third@example.com" });
    const host = makeAttendee({
      guestsInfo: [
        makeGuest({ name: "First Guest", email: "first@example.com", guestIndex: 1 }),
        makeGuest({ name: "Second Guest", email: "second@example.com", guestIndex: 2 }),
        makeGuest({ name: "Third Guest", email: "third@example.com", guestIndex: 3 }),
      ],
    });

    expect(getBidderAttendeeInfo(bidder, [host])).toEqual({ attendee: host, isGuest: true });
  });

  it("finds the right host among several attendees, not just the first one checked", () => {
    const bidder = makeBidder({ firstName: "Bob", lastName: "Guest", email: "bob@example.com" });
    const unrelatedHost = makeAttendee({ id: "tickets-1", firstName: "Unrelated", lastName: "Host" });
    const realHost = makeAttendee({
      id: "tickets-2",
      firstName: "Real",
      lastName: "Host",
      guestsInfo: [makeGuest({ name: "Bob Guest", email: "bob@example.com" })],
    });

    expect(getBidderAttendeeInfo(bidder, [unrelatedHost, realHost])).toEqual({ attendee: realHost, isGuest: true });
  });

  it("matches by the ticket Bidder-Numbers ties them to, even after the ticket's name changed", () => {
    const bidder = makeBidder({ firstName: "Amy/chris", lastName: "Jimieson", ticketRef: "staff tickets!3" });
    const ticket = makeAttendee({ id: "staff-3", sheet: "staff tickets", rowIndex: 3, firstName: "Amy & Chris", lastName: "Jimieson", paymentStatus: "Paid" });

    expect(getBidderAttendeeInfo(bidder, [makeAttendee(), ticket])).toEqual({ attendee: ticket, isGuest: false });
  });

  it("a tie to a guest slot marks the bidder as that ticket's guest", () => {
    const bidder = makeBidder({ firstName: "Someone", lastName: "Renamed", ticketRef: "tickets!2#1" });
    const ticket = makeAttendee({ rowIndex: 2 });

    expect(getBidderAttendeeInfo(bidder, [ticket])).toEqual({ attendee: ticket, isGuest: true });
  });
});
