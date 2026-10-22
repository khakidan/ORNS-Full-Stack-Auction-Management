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
});
