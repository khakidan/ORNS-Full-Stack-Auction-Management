import { describe, it, expect } from "vitest";
import { findBidderColumn, firstEmptyBidRow, findBidderRowIndex } from "../utils/bidGrid";
import { nextBidderId, nextColumnPairStart, walkInGridValues, walkInTicketRow } from "../services/bidderService";
import { AUCTION_TICKETS_ITEM_ID } from "../utils/categoryHelpers";

const GRID = [
  ["101", "", " 102 ", ""],
  ["Ann", "Lee", "Bo", "Ray"],
  ["Item #:", "Price:", "Item #:", "Price:"],
  ["801", "50", "", ""],
];

describe("bidGrid", () => {
  it("findBidderColumn finds the first column of the bidder's pair (ignoring spaces), or -1", () => {
    expect(findBidderColumn(GRID, "101")).toBe(0);
    expect(findBidderColumn(GRID, "102")).toBe(2);
    expect(findBidderColumn(GRID, "Lee")).toBe(-1); // never matches a price column
    expect(findBidderColumn([], "101")).toBe(-1);
  });

  it("firstEmptyBidRow is the first empty row from row 4, else the row after the last one read, never above row 4", () => {
    expect(firstEmptyBidRow(GRID, 0)).toBe(5);
    expect(firstEmptyBidRow(GRID, 2)).toBe(4);
    expect(firstEmptyBidRow(GRID.slice(0, 3), 0)).toBe(4);
    expect(firstEmptyBidRow([], 0)).toBe(4);
  });

  it("findBidderRowIndex skips the header and ignores spaces", () => {
    const rows = [["ID"], ["101"], [" 102 "]];
    expect(findBidderRowIndex(rows, "102")).toBe(2);
    expect(findBidderRowIndex(rows, "ID")).toBe(-1);
    expect(findBidderRowIndex(rows, "999")).toBe(-1);
  });
});

describe("walk-in helpers", () => {
  it("nextBidderId is one above the highest number, and at least 101", () => {
    expect(nextBidderId([["ID"], ["101"], ["140"], ["x"], []])).toBe(141);
    expect(nextBidderId([["ID"]])).toBe(101);
  });

  it("nextColumnPairStart is the first even column after everything used", () => {
    expect(nextColumnPairStart(GRID)).toBe(4);
    expect(nextColumnPairStart([["101", "", "102"]])).toBe(4);
    expect(nextColumnPairStart([])).toBe(0);
  });

  it("walkInGridValues puts the ticket in as the first bid", () => {
    expect(walkInGridValues(141, "Dee", "Moore", 40)).toEqual([[141, ""], ["Dee", "Moore"], ["Item #:", "Price:"], [AUCTION_TICKETS_ITEM_ID, 40]]);
  });

  it("walkInTicketRow fills A-V with one ticket paid at checkout", () => {
    const row = walkInTicketRow("dee", "MOORE", "dee@x.org", 40);
    expect(row).toHaveLength(22);
    expect([row[0], row[1], row[2], row[4], row[5]]).toEqual(["dee", "MOORE", "dee@x.org", "1", "FALSE"]);
    expect(row.slice(19)).toEqual(["Auction Checkout", "Pending", "$40"]);
  });
});
