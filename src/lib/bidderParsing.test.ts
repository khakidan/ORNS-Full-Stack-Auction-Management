import { describe, it, expect } from "vitest";
import { parseBidderRows } from "./bidderParsing";

describe("parseBidderRows", () => {
  it("parses a full row into a Bidder object with 1-based-plus-header rowIndex", () => {
    const rows = [
      ["101", "Dan", "Sage", "dan@example.com", "TRUE", "FALSE", "TRUE", "TRUE", "Cash", "url", "50", "2026-01-01T00:00:00Z"],
    ];

    const [bidder] = parseBidderRows(rows);

    expect(bidder).toEqual({
      id: "101",
      firstName: "Dan",
      lastName: "Sage",
      email: "dan@example.com",
      checkedIn: true,
      isProxy: false,
      checkedOut: true,
      paid: true,
      paymentMethod: "Cash",
      checkoutTimestamp: "2026-01-01T00:00:00Z",
      rowIndex: 2,
    });
  });

  it("defaults paymentMethod to an empty string when the column is blank", () => {
    const rows = [
      ["102", "Amy", "Sedaris", "amy@example.com", "TRUE", "FALSE", "FALSE", "FALSE", "", "", "", ""],
    ];

    const [bidder] = parseBidderRows(rows);

    expect(bidder.paymentMethod).toBe("");
  });

  it("filters out rows with no bidder id", () => {
    const rows = [
      ["", "No", "Id", "", "FALSE", "FALSE", "FALSE", "FALSE", "", "", "", ""],
      ["103", "Has", "Id", "", "FALSE", "FALSE", "FALSE", "FALSE", "", "", "", ""],
    ];

    const result = parseBidderRows(rows);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("103");
  });

  it("treats lowercase 'true' the same as 'TRUE' for boolean columns", () => {
    const rows = [
      ["104", "Lower", "Case", "", "true", "true", "true", "true", "", "", "", ""],
    ];

    const [bidder] = parseBidderRows(rows);

    expect(bidder.checkedIn).toBe(true);
    expect(bidder.isProxy).toBe(true);
    expect(bidder.checkedOut).toBe(true);
    expect(bidder.paid).toBe(true);
  });
});
