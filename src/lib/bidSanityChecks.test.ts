import { describe, it, expect } from "vitest";
import { bidWarnings } from "./bidSanityChecks";
import { AuctionItem } from "@/types";

const item = (overrides: Partial<AuctionItem> = {}): AuctionItem => ({
  id: "1301", name: "Basket", category: "", description: "", value: "$100.00", openingBid: "$45.00",
  minRaise: "$5.00", donor: "", itemType: "", status: "Active", bundleId: "", bundledDateTime: "",
  rowIndex: 2, ...overrides,
});

describe("bidWarnings", () => {
  it.each([45, 50, 72, 150, 300])("accepts a believable amount ($%s)", (price) => {
    expect(bidWarnings(item(), price)).toEqual([]);
  });

  it("flags an amount below the opening bid (a dropped digit)", () => {
    expect(bidWarnings(item(), 15)).toEqual([expect.stringContaining("below the opening bid of $45.00")]);
  });

  it("flags an amount above the opening bid by less than the minimum raise", () => {
    expect(bidWarnings(item(), 47)).toEqual([expect.stringContaining("lowest possible after the opening bid is $50.00")]);
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
