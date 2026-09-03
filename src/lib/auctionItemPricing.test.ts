import { describe, it, expect } from "vitest";
import { parseDollar, calculateAutoBids } from "./auctionItemPricing";

describe("parseDollar", () => {
  it("strips currency formatting and returns a number", () => {
    expect(parseDollar("$1,250.50")).toBe(1250.5);
    expect(parseDollar("100")).toBe(100);
  });

  it("returns 0 for empty, blank, or unparseable input", () => {
    expect(parseDollar("")).toBe(0);
    expect(parseDollar("$")).toBe(0);
    expect(parseDollar("abc")).toBe(0);
  });
});

describe("calculateAutoBids", () => {
  it("returns blank opening/raise for a zero or blank value", () => {
    expect(calculateAutoBids("", [])).toEqual({ opening: "", raise: "" });
    expect(calculateAutoBids("$0.00", [])).toEqual({ opening: "", raise: "" });
  });

  it("computes opening bid as 45% of value", () => {
    expect(calculateAutoBids("$100.00", []).opening).toBe("$45.00");
  });

  it.each([
    [50, 5], [149.99, 5],
    [150, 10], [299.99, 10],
    [300, 15], [449.99, 15],
    [450, 20], [599.99, 20],
    [600, 30], [749.99, 30],
    [750, 40], [899.99, 40],
    [900, 50], [5000, 50],
  ])("falls back to the hardcoded ladder for $%s -> $%s raise when no tiers are configured", (value, expectedRaise) => {
    expect(calculateAutoBids(`$${value}`, []).raise).toBe(`$${expectedRaise.toFixed(2)}`);
  });

  it("uses the provided Value-Calculations tiers instead of the hardcoded ladder when given", () => {
    const tiers = [{ minRange: 0, minRaise: 100 }, { minRange: 1000, minRaise: 200 }];
    expect(calculateAutoBids("$500", tiers).raise).toBe("$100.00");
    expect(calculateAutoBids("$1500", tiers).raise).toBe("$200.00");
  });

  it("sorts unsorted tiers before applying them", () => {
    const tiers = [{ minRange: 1000, minRaise: 200 }, { minRange: 0, minRaise: 100 }];
    expect(calculateAutoBids("$500", tiers).raise).toBe("$100.00");
  });
});
