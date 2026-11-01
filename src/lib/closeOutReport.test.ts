import { describe, it, expect } from "vitest";
import { buildCloseOutReport, paymentMethodLabel, pendingCheckoutBidders, sourceOf, type CloseOutInput } from "./closeOutReport";
import type { AuctionItem, Bidder } from "@/types";

const bidder = (id: string, first: string, over: Partial<Bidder> = {}): Bidder => ({
  id, firstName: first, lastName: "Test", email: `${first.toLowerCase()}@example.com`,
  checkedIn: true, isProxy: false, checkedOut: true, paid: true, paymentMethod: "Cash", rowIndex: Number(id) + 1, ...over,
});
const item = (id: string, category: string, name: string): AuctionItem => ({
  id, category, name, description: "", value: "", openingBid: "", minRaise: "", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "", rowIndex: 2,
});

const items = [
  item("101", "Food & Dining", "Pizza night"),
  item("102", "Classroom Art", "Butterflies"),
  item("103", "Retail", "Never sold"),
  item("1301", "Live Auction", "Cape Cod week"),
  item("1504", "Raffle Tickets", "One 50/50 Raffle Ticket"),
  item("1601", "Open Appeal", "Open Appeal for $500"),
];

function input(over: Partial<CloseOutInput> = {}): CloseOutInput {
  return {
    bidders: [
      bidder("1", "Ann", { paymentMethod: "Credit Card / PayPal" }),
      bidder("2", "Ben", { checkedOut: false, paid: false, paymentMethod: "" }),
      bidder("3", "Cat", { checkedOut: false, paid: true, paymentMethod: "Check" }),
      bidder("4", "Dee", { checkedIn: false, checkedOut: true, paid: false, paymentMethod: "" }),
      bidder("5", "Eve", { checkedIn: false, isProxy: true, checkedOut: false, paid: false, paymentMethod: "" }),
      bidder("6", "Fay", { paymentMethod: "Cash" }),
    ],
    items,
    wins: [
      { bidderId: "1", itemId: "1301", price: 6200 },
      { bidderId: "1", itemId: "1504", price: 20 },
      { bidderId: "2", itemId: "101", price: 240 },
      { bidderId: "3", itemId: "1601", price: 500 },
      { bidderId: "5", itemId: "102", price: 300 },
      { bidderId: "6", itemId: "1504", price: 40 },
      { bidderId: "6", itemId: "102", price: 0 },
    ],
    winners: { "1301": "Ann Test", "1504": "Fay Test", "101": "Ben Test", "1601": "Cat Test", "102": "Eve Test" },
    totalRaised: 7300,
    // Fay won the 50/50 ticket after checking out ($40 still due); the gift card row has no amount.
    followUpRows: [["6", "1504", "40"], ["1", "$500 Amazon Gift Card", ""], ["", "", ""]],
    giftCardWinnerId: "1",
    raffleWinnerId: "99",
    ...over,
  };
}

describe("pendingCheckoutBidders (the Dashboard's Still Need to Check Out list)", () => {
  it("lists present bidders not checked out, and proxy bidders who won something", () => {
    const { bidders, winners } = input();
    expect(pendingCheckoutBidders(bidders, winners).map((b) => b.id)).toEqual(["2", "3", "5"]);
  });

  it("leaves out a proxy bidder who won nothing", () => {
    const { bidders } = input();
    expect(pendingCheckoutBidders(bidders, {}).map((b) => b.id)).toEqual(["2", "3"]);
  });
});

describe("sourceOf / paymentMethodLabel", () => {
  it("reports the five named categories as themselves and everything else as Silent Auction", () => {
    expect(sourceOf("Open Appeal")).toBe("Open Appeal");
    expect(sourceOf("raffle tickets")).toBe("Raffle Tickets");
    expect(sourceOf("Auction Tickets")).toBe("Auction Tickets");
    expect(sourceOf("Movie Night")).toBe("Movie Night");
    expect(sourceOf("Live Auction Items")).toBe("Live Auction");
    expect(sourceOf("Classroom Art")).toBe("Silent Auction");
    expect(sourceOf(undefined)).toBe("Silent Auction");
  });

  it("names the payment methods Bid Management records", () => {
    expect(paymentMethodLabel("Cash")).toBe("Cash");
    expect(paymentMethodLabel("Check")).toBe("Check");
    expect(paymentMethodLabel("Credit Card / PayPal")).toBe("Card (PayPal)");
    expect(paymentMethodLabel("PayPal Verification Pending")).toBe("PayPal Verification Pending");
    expect(paymentMethodLabel("")).toBe("Not recorded");
  });
});

describe("buildCloseOutReport", () => {
  it("shows what each bidder still owing has to pay, from their wins", () => {
    const r = buildCloseOutReport(input());
    expect(r.pending).toEqual([
      { id: "2", name: "Ben Test", email: "ben@example.com", paid: false, isProxy: false, due: 240 },
      { id: "3", name: "Cat Test", email: "cat@example.com", paid: true, isProxy: false, due: 0 },
      { id: "5", name: "Eve Test", email: "eve@example.com", paid: false, isProxy: true, due: 300 },
    ]);
  });

  it("names the Follow-Up rows' bidders and items, and skips blank rows", () => {
    const r = buildCloseOutReport(input());
    expect(r.followUps).toEqual([
      { bidderId: "6", name: "Fay Test", item: "One 50/50 Raffle Ticket", due: 40 },
      { bidderId: "1", name: "Ann Test", item: "$500 Amazon Gift Card", due: 0 },
    ]);
  });

  it("counts a paid bidder's wins as collected, less a Follow-Up amount still due, by payment method", () => {
    const r = buildCloseOutReport(input());
    // Ann 6220 by card, Cat 500 by check, Fay 40 - 40 due = nothing collected.
    expect(r.methods).toEqual([
      { name: "Card (PayPal)", amount: 6220, count: 1 },
      { name: "Check", amount: 500, count: 1 },
    ]);
    expect(r.collected).toBe(6720);
    expect(r.winsTotal).toBe(7300);
    expect(r.owed).toBe(580); // Ben 240 + Eve 300 + Fay's 40
  });

  it("groups the winning bids by source, biggest first", () => {
    const r = buildCloseOutReport(input());
    expect(r.sources).toEqual([
      { name: "Live Auction", amount: 6200 },
      { name: "Silent Auction", amount: 540 },
      { name: "Open Appeal", amount: 500 },
      { name: "Raffle Tickets", amount: 60 },
    ]);
  });

  it("lists the five highest winning bids with their item names", () => {
    const r = buildCloseOutReport(input());
    expect(r.topWins.map((w) => [w.itemId, w.item, w.bidderId, w.amount])).toEqual([
      ["1301", "Cape Cod week", "1", 6200],
      ["1601", "Open Appeal for $500", "3", 500],
      ["102", "Butterflies", "5", 300],
      ["101", "Pizza night", "2", 240],
      ["1504", "One 50/50 Raffle Ticket", "6", 40],
    ]);
  });

  it("calls an item unsold only when nobody won it and it isn't a standard item", () => {
    const r = buildCloseOutReport(input({ items: [...items, item("1401", "Movie Night", "A Night with the ORNS Staff")] }));
    expect(r.unsold).toEqual([{ id: "103", name: "Never sold" }]);
  });

  it("adds up the 50/50 tickets and resolves the special winners", () => {
    const r = buildCloseOutReport(input());
    expect(r.raffleGross).toBe(60);
    expect(r.giftCard).toEqual({ id: "1", name: "Ann Test", checkedOut: true });
    expect(r.raffle).toEqual({ id: "99", name: "Bidder not found", checkedOut: false });
    expect(buildCloseOutReport(input({ giftCardWinnerId: " " })).giftCard).toBeNull();
  });

  it("counts attendance the Dashboard's way, with proxies apart from no-shows", () => {
    const r = buildCloseOutReport(input());
    expect(r.attendance).toEqual({ checkedOut: 3, presentNotOut: 2, neverIn: 1, proxies: 1 });
    expect(r.noShows).toEqual([{ id: "4", name: "Dee Test", email: "dee@example.com" }]);
    expect(r.proxies).toEqual([{ id: "5", name: "Eve Test", wins: 1, checkedOut: false }]);
  });
});
