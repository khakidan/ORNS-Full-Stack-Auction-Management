import { describe, it, expect } from "vitest";
import { parseBidGrid } from "./bidGridParsing";

// Column-pair grid shape: header row holds bidder IDs in pairs (bidder col,
// blank col); rows 1-2 are unrelated header/detail rows; data starts at
// row index 3. Each bidder's two columns hold (item ID, price) per row.
const HEADER = ["101", "", "102", ""];
const ROW1 = ["Header", "Details", "Header", "Details"];
const ROW2 = ["More", "Stuff", "More", "Stuff"];

describe("parseBidGrid", () => {
  it("returns one win per (bidder, item, price) cell pair", () => {
    const values = [HEADER, ROW1, ROW2, ["item1", "$50.00", "item2", "$75.00"]];
    expect(parseBidGrid(values)).toEqual([
      { bidderId: "101", itemId: "item1", price: 50 },
      { bidderId: "102", itemId: "item2", price: 75 },
    ]);
  });

  it("collects multiple winning rows for the same bidder", () => {
    const values = [
      HEADER,
      ROW1,
      ROW2,
      ["item1", "$50.00", "", ""],
      ["item3", "$20.00", "", ""],
    ];
    expect(parseBidGrid(values)).toEqual([
      { bidderId: "101", itemId: "item1", price: 50 },
      { bidderId: "101", itemId: "item3", price: 20 },
    ]);
  });

  it("counts an item as won even when its price cell is blank or malformed (defaults to 0)", () => {
    // Items.tsx relies on this: a winner shown for an item shouldn't
    // silently disappear just because the price didn't parse.
    const values = [HEADER, ROW1, ROW2, ["item1", "", "item2", "not-a-number"]];
    expect(parseBidGrid(values)).toEqual([
      { bidderId: "101", itemId: "item1", price: 0 },
      { bidderId: "102", itemId: "item2", price: 0 },
    ]);
  });

  it("skips a column pair with no bidder ID in the header", () => {
    const values = [
      ["101", "", "", "", "103", ""],
      ROW1,
      ROW2,
      ["item1", "$10.00", "item2", "$20.00", "item3", "$30.00"],
    ];
    expect(parseBidGrid(values)).toEqual([
      { bidderId: "101", itemId: "item1", price: 10 },
      { bidderId: "103", itemId: "item3", price: 30 },
    ]);
  });

  it("skips a row with no value in the item-ID cell for that bidder's column", () => {
    const values = [HEADER, ROW1, ROW2, ["", "", "item2", "$75.00"]];
    expect(parseBidGrid(values)).toEqual([{ bidderId: "102", itemId: "item2", price: 75 }]);
  });

  it("parses prices with currency symbols and thousands separators", () => {
    const values = [HEADER, ROW1, ROW2, ["item1", "$1,250.50", "", ""]];
    expect(parseBidGrid(values)).toEqual([{ bidderId: "101", itemId: "item1", price: 1250.5 }]);
  });

  it("returns an empty array for undefined, null, or too-short input", () => {
    expect(parseBidGrid(undefined)).toEqual([]);
    expect(parseBidGrid(null)).toEqual([]);
    expect(parseBidGrid([HEADER, ROW1, ROW2])).toEqual([]); // no data rows past the header block
  });

  it("reads well past row 100 (the old useCheckoutState.ts range cap)", () => {
    const values: string[][] = [HEADER, ROW1, ROW2];
    for (let i = 0; i < 200; i++) values.push(["", "", "", ""]);
    values.push(["item1", "$99.00", "", ""]); // row 204
    expect(parseBidGrid(values)).toEqual([{ bidderId: "101", itemId: "item1", price: 99 }]);
  });
});
