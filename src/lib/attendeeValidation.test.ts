import { describe, it, expect } from "vitest";
import { hasMoreGuestsThanTicketsPurchased } from "./attendeeValidation";
import { Guest } from "@/types";

function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    name: "Guest",
    firstName: "Guest",
    lastName: "One",
    email: "guest@example.com",
    guestIndex: 1,
    ownBidderNumber: "",
    ...overrides,
  };
}

describe("hasMoreGuestsThanTicketsPurchased", () => {
  it("flags the exact user-reported case: 1 ticket purchased, 3 guests listed", () => {
    const guests = [makeGuest({ guestIndex: 1 }), makeGuest({ guestIndex: 2 }), makeGuest({ guestIndex: 3 })];
    expect(hasMoreGuestsThanTicketsPurchased({ ticketsPurchased: "1", guestsInfo: guests })).toBe(true);
  });

  it("does not flag when guest count is less than or equal to tickets purchased", () => {
    const guests = [makeGuest({ guestIndex: 1 })];
    expect(hasMoreGuestsThanTicketsPurchased({ ticketsPurchased: "2", guestsInfo: guests })).toBe(false);
    expect(hasMoreGuestsThanTicketsPurchased({ ticketsPurchased: "1", guestsInfo: guests })).toBe(false);
  });

  it("does not flag a bidder with no guests, regardless of tickets purchased", () => {
    expect(hasMoreGuestsThanTicketsPurchased({ ticketsPurchased: "0", guestsInfo: [] })).toBe(false);
    expect(hasMoreGuestsThanTicketsPurchased({ ticketsPurchased: "5", guestsInfo: [] })).toBe(false);
  });

  it("treats a blank/non-numeric ticketsPurchased as 0, so any guest at all is flagged", () => {
    const guests = [makeGuest()];
    expect(hasMoreGuestsThanTicketsPurchased({ ticketsPurchased: "", guestsInfo: guests })).toBe(true);
    expect(hasMoreGuestsThanTicketsPurchased({ ticketsPurchased: "not-a-number", guestsInfo: guests })).toBe(true);
  });
});
