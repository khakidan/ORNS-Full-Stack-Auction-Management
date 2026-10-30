/**
 * ROADMAP W7: a website purchase arriving once the auction is Live gets a
 * ticket row but no bidder number, so it goes on the Website Ticket Check
 * card for staff to register as a walk-in.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { noteIfAfterGoLive, listAfterGoLive, markAfterGoLiveHandled, clearAfterGoLive } from "../services/ticketsAfterGoLive";
import { TicketPurchase } from "../services/ticketPurchaseRow";
import { getAdminFirestore } from "../services/firebaseAdmin";

const purchase = (overrides: Partial<TicketPurchase> = {}): TicketPurchase => ({
  entryId: "1500", firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "555-0100", tickets: 2,
  guests: [
    { firstName: "Sam", lastName: "Lee", email: "", ownBidderNumber: true },
    { firstName: "Jo", lastName: "Lee", email: "", ownBidderNumber: false },
    { firstName: "", lastName: "", email: "", ownBidderNumber: true },
  ],
  paymentMethod: "test", paymentStatus: "pending", total: 70,
  ...overrides,
});

/** Bid Management in `state`, with Bidder-Numbers' ticket refs (column O) as given - each bidder the buyer, Pat Lee, unless `bidders` says otherwise. */
function fakeSheets(state: string, refs: string[] = [], bidders: unknown[][] = refs.map(() => ["101", "Pat", "Lee", "pat@example.com"])) {
  const get = vi.fn(async ({ range }: { range: string }) => {
    if (range === "'Auction-Status'!A2") return { data: { values: [[state]] } };
    if (range === "'Bidder-Numbers'!A:O") return { data: { values: [["ID"], ...refs.map((r, i) => [...bidders[i], "", "", "", "", "", "", "", "", "", "", r])] } };
    throw new Error(`unexpected read ${range}`);
  });
  return { sheets: { spreadsheets: { values: { get } } } as any, get };
}

const flagged = (id: string) => getAdminFirestore().collection("ticketPurchasesAfterGoLive").doc(id);

beforeEach(async () => {
  await getAdminFirestore().collection("settings").doc("global").set({
    auctionTicketsSpreadsheetId: "tk", bidManagementSpreadsheetId: "bm", bidderNumbersSheet: "Bidder-Numbers",
  });
});

describe("noteIfAfterGoLive", () => {
  it("does nothing while the auction is in Prep - the ticket sync gives the buyer a bidder number", async () => {
    const { sheets, get } = fakeSheets("Prep");
    expect(await noteIfAfterGoLive(sheets, purchase(), 9)).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect((await flagged("1500").get()).exists).toBe(false);
  });

  it("flags a Live-auction purchase with no bidder: who, how many tickets, which guests need numbers, and how they're paying", async () => {
    const { sheets } = fakeSheets("Live", ["tickets!2", "tickets!3"]);

    expect(await noteIfAfterGoLive(sheets, purchase(), 9)).toBe(true);

    expect(await listAfterGoLive()).toEqual([expect.objectContaining({
      entryId: "1500", name: "Pat Lee", tickets: 2, guestsWantingNumbers: ["Sam Lee"], paymentStatus: "Pending", state: "live",
    })]);
  });

  it("calls an online payment Paid, and flags after Close too", async () => {
    await noteIfAfterGoLive(fakeSheets("Closed").sheets, purchase({ paymentStatus: "paid" }), 9);
    expect(await listAfterGoLive()).toEqual([expect.objectContaining({ paymentStatus: "Paid", state: "closed" })]);
  });

  it("leaves a purchase whose buyer already has a bidder - bought before Go Live, its webhook just arrived later", async () => {
    const { sheets } = fakeSheets("Live", ["tickets!9"]);
    expect(await noteIfAfterGoLive(sheets, purchase(), 9)).toBe(false);
    expect(await listAfterGoLive()).toEqual([]);
  });

  it("counts the bidder on that row only if they share the buyer's email or name", async () => {
    // Same email, name typed differently: the buyer.
    expect(await noteIfAfterGoLive(fakeSheets("Live", ["tickets!9"], [["101", "Patricia", "Lee", "PAT@example.com"]]).sheets, purchase(), 9)).toBe(false);
    // Same name, no email on the bidder: the buyer.
    expect(await noteIfAfterGoLive(fakeSheets("Live", ["tickets!9"], [["101", "PAT", "lee", ""]]).sheets, purchase(), 9)).toBe(false);
    expect(await listAfterGoLive()).toEqual([]);
  });

  it("flags a purchase that reused a deleted row's number - the bidder still tied to that row is someone else", async () => {
    const { sheets } = fakeSheets("Live", ["tickets!9"], [["101", "Refunded", "Buyer", "gone@example.com"]]);
    expect(await noteIfAfterGoLive(sheets, purchase(), 9)).toBe(true);
    expect(await listAfterGoLive()).toEqual([expect.objectContaining({ entryId: "1500", name: "Pat Lee" })]);
  });

  it("flags one that has no row yet (shadow mode, before the Sheets feed writes it) without looking for a bidder", async () => {
    const { sheets, get } = fakeSheets("Live");
    expect(await noteIfAfterGoLive(sheets, purchase(), null)).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("flags each purchase once, and never brings back one staff marked done", async () => {
    const { sheets } = fakeSheets("Live");
    await noteIfAfterGoLive(sheets, purchase(), 9);
    await markAfterGoLiveHandled("1500", "jane@orns.org");

    expect(await noteIfAfterGoLive(sheets, purchase({ firstName: "Changed" }), 9)).toBe(true);

    expect(await listAfterGoLive()).toEqual([]);
    expect((await flagged("1500").get()).data()).toMatchObject({ name: "Pat Lee", handledBy: "jane@orns.org" });
  });

  it("does nothing until the Bid Management spreadsheet is set", async () => {
    await getAdminFirestore().collection("settings").doc("global").set({ auctionTicketsSpreadsheetId: "tk" });
    const { sheets, get } = fakeSheets("Live");
    expect(await noteIfAfterGoLive(sheets, purchase(), 9)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("markAfterGoLiveHandled / clearAfterGoLive", () => {
  it("takes a purchase off the list once, and only one that's on it", async () => {
    await noteIfAfterGoLive(fakeSheets("Live").sheets, purchase(), 9);

    expect(await markAfterGoLiveHandled("1500", "jane@orns.org")).toMatchObject({ name: "Pat Lee" });
    expect(await markAfterGoLiveHandled("1500", "jane@orns.org")).toBeNull();
    expect(await markAfterGoLiveHandled("1501", "jane@orns.org")).toBeNull();
    expect(await markAfterGoLiveHandled("../x", "jane@orns.org")).toBeNull();
  });

  it("empties the list for a new auction year", async () => {
    await noteIfAfterGoLive(fakeSheets("Live").sheets, purchase(), 9);
    await clearAfterGoLive();
    expect((await flagged("1500").get()).exists).toBe(false);
  });
});
