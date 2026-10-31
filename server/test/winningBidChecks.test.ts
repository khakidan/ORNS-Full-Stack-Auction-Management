import { describe, it, expect } from "vitest";
import { findExistingWins, isRepeatableItem } from "../utils/winningBidChecks";

describe("findExistingWins", () => {
  const grid = [
    ["101", "", "102", "", "103", ""],
    ["Total", "", "", "", "", ""],
    ["", "", "", "", "", ""],
    ["1301", "$900.00", "2104", "25", "", ""],
    ["2104", "$25", "", "", "", ""],
  ];

  it("finds every bidder who won the item, with the price", () => {
    expect(findExistingWins(grid, "2104")).toEqual([{ bidderId: "101", price: 25 }, { bidderId: "102", price: 25 }]);
    expect(findExistingWins(grid, "1301")).toEqual([{ bidderId: "101", price: 900 }]);
  });

  it("ignores the three header rows and items nobody won", () => {
    expect(findExistingWins(grid, "Total")).toEqual([]);
    expect(findExistingWins(grid, "9999")).toEqual([]);
  });
});

describe("isRepeatableItem", () => {
  const header = ["Item Number", "Category", "Item Name", "", "", "", "", "", "", "", "", "", "Allow Multiple Winners"];

  it("reads the Allow Multiple Winners column, as a checkbox or as text", () => {
    expect(isRepeatableItem([header, ["2104", "", "Raffle", ...Array(9).fill(""), true]], "2104")).toBe(true);
    expect(isRepeatableItem([header, ["2104", "", "Raffle", ...Array(9).fill(""), "TRUE"]], "2104")).toBe(true);
    expect(isRepeatableItem([header, ["1301", "", "Cabin", ...Array(9).fill(""), false]], "1301")).toBe(false);
  });

  it("is undefined for an item that isn't listed", () => {
    expect(isRepeatableItem([header], "1301")).toBeUndefined();
  });

  it("finds the column by its header when it has moved", () => {
    expect(isRepeatableItem([["ID", "Multiple Winners"], ["7", "TRUE"]], "7")).toBe(true);
  });
  it("always lets a standard item have several winners - Movie Night and Auction Tickets too - whatever its flag says", () => {
    expect(isRepeatableItem([header, ["1401", "", "A Night with the ORNS Staff", ...Array(9).fill(""), false]], "1401")).toBe(true);
    expect(isRepeatableItem([header, ["1701", "", "Auction Tickets", ...Array(9).fill(""), ""]], "1701")).toBe(true);
    expect(isRepeatableItem([header, ["1504", "", "One 50/50 Raffle Ticket $20", ...Array(9).fill(""), false]], "1504")).toBe(true);
  });
});

// ROADMAP T17: what Stryker showed no test checked.
describe("findExistingWins - edges the mutation run found untested", () => {
  it("matches IDs with spaces around them, in the grid, the header and the request", () => {
    const grid = [[" 101 ", ""], ["Total", ""], ["", ""], [" 2104 ", "$25"]];
    expect(findExistingWins(grid, " 2104")).toEqual([{ bidderId: "101", price: 25 }]);
  });

  it("credits nobody for a column pair with no bidder ID", () => {
    const grid = [["", "", "102", ""], ["Total", "", "", ""], ["", "", "", ""], ["2104", "$25", "", ""]];
    expect(findExistingWins(grid, "2104")).toEqual([]);
  });
});

describe("isRepeatableItem - edges the mutation run found untested", () => {
  it("finds the item number by its header when it isn't in column A", () => {
    expect(isRepeatableItem([["Name", "Item Number", "Allow Multiple Winners"], ["2104", "1301", "TRUE"]], "1301")).toBe(true);
    expect(isRepeatableItem([["Name", "Item Number", "Allow Multiple Winners"], ["2104", "1301", "TRUE"]], "2104")).toBeUndefined();
  });

  it("finds a header that only contains the name, such as 'Auction Item Number'", () => {
    expect(isRepeatableItem([["Name", "Auction Item Number", "Allow Multiple Winners?"], ["Raffle", "2104", "TRUE"]], "2104")).toBe(true);
  });

  it("falls back to column A for the item number, and M for the flag, when no header names them", () => {
    const row = ["2104", ...Array(11).fill(""), "TRUE"];
    expect(isRepeatableItem([Array(13).fill("Other"), row], "2104")).toBe(true);
  });

  it("reads the asked-for item's own row, not the first one", () => {
    const rows = [["Item Number", "Allow Multiple Winners"], ["1301", "FALSE"], ["2104", "TRUE"]];
    expect(isRepeatableItem(rows, "2104")).toBe(true);
    expect(isRepeatableItem(rows, "1301")).toBe(false);
  });

  it("matches the item number and headers with spaces around them", () => {
    expect(isRepeatableItem([[" Item Number ", " Allow Multiple Winners "], [" 2104 ", "TRUE"]], " 2104")).toBe(true);
  });
});

