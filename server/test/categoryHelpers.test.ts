import { describe, it, expect } from "vitest";
import { getCategoryBase, AUCTION_TICKETS_CATEGORY_BASE, AUCTION_TICKETS_ITEM_ID } from "../utils/categoryHelpers";

describe("getCategoryBase - Auction Tickets", () => {
  it("routes 'Auction Tickets' to its own base (1701), not the generic Sports/Tickets base (1201)", () => {
    // "Auction Tickets" contains the substring "ticket", which the
    // generic sports/tickets branch below it would otherwise match first
    // - this is the exact collision risk introduced when Auction Tickets
    // became its own category instead of living inside item #1606.
    expect(getCategoryBase("Auction Tickets")).toBe(AUCTION_TICKETS_CATEGORY_BASE);
    expect(getCategoryBase("Auction Tickets")).toBe(1701);
  });

  it("still routes real Sports/Tickets categories to 1201, unaffected by the new Auction Tickets branch", () => {
    expect(getCategoryBase("Sports Memorabilia & Tickets")).toBe(1201);
    expect(getCategoryBase("Tickets")).toBe(1201);
  });

  it("still routes Raffle Tickets to 1501, not the generic ticket branch or the new Auction Tickets branch", () => {
    expect(getCategoryBase("Raffle Tickets")).toBe(1501);
  });

  it("keeps AUCTION_TICKETS_ITEM_ID and AUCTION_TICKETS_CATEGORY_BASE as the same numeric value", () => {
    // bidderService.ts records ticket purchases under AUCTION_TICKETS_ITEM_ID
    // (a string); auctionSetupService.ts seeds the standard item under the
    // same value. They must never drift apart.
    expect(AUCTION_TICKETS_ITEM_ID).toBe(String(AUCTION_TICKETS_CATEGORY_BASE));
  });
});
