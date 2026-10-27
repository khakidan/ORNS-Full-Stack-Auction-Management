import { describe, it, expect } from "vitest";
import { parseAuctionState } from "./auctionState";

describe("parseAuctionState", () => {
  it("reads Prep, Live and Closed whatever the case", () => {
    expect(parseAuctionState("Prep")).toBe("prep");
    expect(parseAuctionState("live")).toBe("live");
    expect(parseAuctionState("CLOSED")).toBe("closed");
  });

  it("reads a sheet from before the three states: TRUE is Prep, FALSE (boolean or text) is Closed", () => {
    expect(parseAuctionState(true)).toBe("prep");
    expect(parseAuctionState("TRUE")).toBe("prep");
    expect(parseAuctionState(false)).toBe("closed");
    expect(parseAuctionState("FALSE")).toBe("closed");
  });

  it("treats blank or unrecognized as Prep, never Closed", () => {
    expect(parseAuctionState(undefined)).toBe("prep");
    expect(parseAuctionState("")).toBe("prep");
    expect(parseAuctionState("soon")).toBe("prep");
  });
});
