import { describe, it, expect } from "vitest";
import { bidWarnings } from "./bidSanityChecks";
import { AuctionItem } from "@/types";

const item = (overrides: Partial<AuctionItem> = {}): AuctionItem => ({
  id: "1301", name: "Basket", category: "", description: "", value: "$100.00", openingBid: "$45.00",
  minRaise: "$5.00", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "",
  rowIndex: 2, ...overrides,
});

describe("bidWarnings", () => {
  it.each([45, 50, 55, 150, 300])("accepts a possible amount ($%s)", (price) => {
    expect(bidWarnings(item(), price)).toEqual([]);
  });

  it("flags an amount below the opening bid (a dropped digit)", () => {
    expect(bidWarnings(item(), 15)).toEqual([expect.stringContaining("below the opening bid of $45.00")]);
  });

  it("flags an amount that isn't the opening bid plus whole minimum raises", () => {
    const tenAndFive = item({ openingBid: "$10.00", minRaise: "$5.00", value: "$40.00" });
    expect(bidWarnings(tenAndFive, 22)).toEqual([expect.stringContaining("The nearest are $20.00 and $25.00")]);
    expect(bidWarnings(tenAndFive, 12)).toEqual([expect.stringContaining("The nearest are $10.00 and $15.00")]);
    expect(bidWarnings(item(), 72)).toHaveLength(1);
    expect(bidWarnings(tenAndFive, 25)).toEqual([]);
  });

  it.each([
    ["a Live-auction item (called by the auctioneer)", { category: "Live" }],
    ["raffle tickets", { category: "Raffle Tickets" }],
    ["an Open Appeal tier", { category: "Open Appeal" }],
    ["an item several people can win", { allowMultipleWinners: true }],
  ])("doesn't apply the step rule to %s (ROADMAP A12), but still checks the opening bid", (_label, overrides) => {
    const unstepped = item({ openingBid: "$10.00", minRaise: "$5.00", value: "$40.00", ...overrides });
    expect(bidWarnings(unstepped, 22)).toEqual([]);
    expect(bidWarnings(unstepped, 5)).toEqual([expect.stringContaining("below the opening bid")]);
  });

  it("still applies the step rule to an ordinary silent-auction category", () => {
    expect(bidWarnings(item({ category: "Food", openingBid: "$10.00", minRaise: "$5.00", value: "$40.00" }), 22)).toHaveLength(1);
  });

  it("flags an amount more than 3 times the value (an extra digit)", () => {
    expect(bidWarnings(item(), 1500)).toEqual([expect.stringContaining("more than 3 times the item's value of $100.00")]);
  });

  it("flags $0 and unreadable amounts", () => {
    expect(bidWarnings(item(), 0)).toEqual(["The amount is $0."]);
    expect(bidWarnings(item(), NaN)).toEqual(["The amount is $0."]);
  });

  it("skips a check when the item has no such figure", () => {
    expect(bidWarnings(item({ openingBid: "", value: "" }), 2)).toEqual([]);
    expect(bidWarnings(item({ minRaise: "" }), 47)).toEqual([]);
  });

  it("isn't fooled by cents (opening bids like $67.50)", () => {
    expect(bidWarnings(item({ value: "$150.00", openingBid: "$67.50", minRaise: "$10.00" }), 77.5)).toEqual([]);
    expect(bidWarnings(item({ value: "$150.00", openingBid: "$67.50", minRaise: "$10.00" }), 75)).toHaveLength(1);
  });
});
