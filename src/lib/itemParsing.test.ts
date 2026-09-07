import { describe, it, expect } from "vitest";
import { parseItemRows } from "./itemParsing";

// Two real header-text flavors actually present in this codebase:
//  - "fixture" style, used by the test suites (useAuctionItems.test.ts,
//    AuctionItemManager_UnitTests.gs)
//  - "production" style, the ACTUAL header row server/services/itemService.ts
//    writes to a brand-new Auction-Items sheet (addItem, when the sheet is
//    empty) - longer, more verbose column names.
// Both must resolve to the same column mapping; this is what caught the
// donor/itemType columns silently relying on positional fallback rather
// than real name detection (see CHANGELOG.md) - neither "Donated By" nor
// "Physical Item, Certificate, or Both?"/"Physical/Cert" matched the old
// candidate lists (["donor"], ["item type", "type"]) at all.
const FIXTURE_HEADER = ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical/Cert", "Status", "Bundle ID", "Bundled Date/Time"];
const PRODUCTION_HEADER = ["Auction Item ID", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise Amount", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"];

const SAMPLE_ROW = ["801", "Food", "Pizza Night", "A fun night", "$500", "$250", "$20", "Joe's Pizza", "Certificate", "Active", "", ""];

describe("parseItemRows - column detection under real header text", () => {
  it("correctly maps every field under the fixture-style header", () => {
    const [item] = parseItemRows([FIXTURE_HEADER, SAMPLE_ROW]);
    expect(item).toMatchObject({
      id: "801",
      category: "Food",
      name: "Pizza Night",
      description: "A fun night",
      value: "$500",
      openingBid: "$250",
      minRaise: "$20",
      donor: "Joe's Pizza",
      itemType: "Certificate",
      status: "Active",
      bundleId: "",
      bundledDateTime: "",
      rowIndex: 2,
    });
  });

  it("correctly maps every field under the actual production header itemService.ts writes - the real-world case", () => {
    const [item] = parseItemRows([PRODUCTION_HEADER, SAMPLE_ROW]);
    expect(item).toMatchObject({
      id: "801",
      category: "Food",
      name: "Pizza Night",
      description: "A fun night",
      value: "$500",
      openingBid: "$250",
      minRaise: "$20",
      donor: "Joe's Pizza",
      itemType: "Certificate",
      status: "Active",
    });
  });

  it("follows the header labels, not fixed positions, when real-world columns are reordered", () => {
    // Swap Donated By/Physical.../Status/Bundle ID around - a real-world
    // drift scenario this header-name-detection mechanism exists to
    // survive. If any column silently falls back to its default index
    // instead of following its actual header, this catches it.
    const reordered = ["Auction Item ID", "Category", "Item Name", "Description", "Status", "Bundle ID", "Value", "Opening Bid", "Physical Item, Certificate, or Both?", "Min Raise Amount", "Donated By", "Bundled Date/Time"];
    const row = ["801", "Food", "Pizza Night", "A fun night", "Active", "B-1", "$500", "$250", "Certificate", "$20", "Joe's Pizza", "2026-01-01"];

    const [item] = parseItemRows([reordered, row]);
    expect(item).toMatchObject({
      id: "801",
      category: "Food",
      name: "Pizza Night",
      description: "A fun night",
      status: "Active",
      bundleId: "B-1",
      value: "$500",
      openingBid: "$250",
      itemType: "Certificate",
      minRaise: "$20",
      donor: "Joe's Pizza",
      bundledDateTime: "2026-01-01",
    });
  });

  it("matches header names case-insensitively and ignores surrounding whitespace", () => {
    const messyHeader = [" ITEM NUMBER ", "category", "  Item Name", "DESCRIPTION  ", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical/Cert", "STATUS", "Bundle ID", "Bundled Date/Time"];
    const [item] = parseItemRows([messyHeader, SAMPLE_ROW]);
    expect(item.id).toBe("801");
    expect(item.name).toBe("Pizza Night");
    expect(item.status).toBe("Active");
  });
});

describe("parseItemRows - fallback behavior", () => {
  it("falls back to the default positional index when a header cell is blank", () => {
    const headerWithBlankDonor = ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "", "Physical/Cert", "Status", "Bundle ID", "Bundled Date/Time"];
    const [item] = parseItemRows([headerWithBlankDonor, SAMPLE_ROW]);
    // Falls back to index 7, which is still "Joe's Pizza" in this row -
    // proving the blank header didn't throw or silently drop the field.
    expect(item.donor).toBe("Joe's Pizza");
  });

  it("defaults status to 'Active' when the status cell is blank", () => {
    const row = ["801", "Food", "Pizza Night", "", "", "", "", "", "", "", "", ""];
    const [item] = parseItemRows([FIXTURE_HEADER, row]);
    expect(item.status).toBe("Active");
  });

  it("defaults every other blank field to an empty string, not undefined", () => {
    const row = ["801", "Food", "Pizza Night", "", "", "", "", "", "", "", "", ""];
    const [item] = parseItemRows([FIXTURE_HEADER, row]);
    expect(item.value).toBe("");
    expect(item.donor).toBe("");
    expect(item.bundleId).toBe("");
  });
});

describe("parseItemRows - row inclusion/exclusion and indexing", () => {
  it("sets rowIndex to the real 1-based sheet row (header row + 1-based offset)", () => {
    const rows = [FIXTURE_HEADER, SAMPLE_ROW, ["802", "Food", "Tacos", "", "", "", "", "", "", "", "", ""]];
    const items = parseItemRows(rows);
    expect(items[0].rowIndex).toBe(2);
    expect(items[1].rowIndex).toBe(3);
  });

  it("drops a row with neither an id nor a name", () => {
    const rows = [FIXTURE_HEADER, SAMPLE_ROW, ["", "Food", "", "orphan row", "", "", "", "", "", "", "", ""]];
    const items = parseItemRows(rows);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("801");
  });

  it("keeps a row with only an id or only a name", () => {
    const rows = [
      FIXTURE_HEADER,
      ["802", "", "", "", "", "", "", "", "", "", "", ""],
      ["", "", "Unnumbered Item", "", "", "", "", "", "", "", "", ""],
    ];
    const items = parseItemRows(rows);
    expect(items).toHaveLength(2);
  });
});

describe("parseItemRows - allowMultipleWinners (column M)", () => {
  const HEADER_WITH_FLAG = [...FIXTURE_HEADER, "Allow Multiple Winners"];

  it("parses a literal boolean true (Sheets' checkbox-cell shape) as true", () => {
    const row = [...SAMPLE_ROW, true];
    const [item] = parseItemRows([HEADER_WITH_FLAG, row as any]);
    expect(item.allowMultipleWinners).toBe(true);
  });

  it("parses the string 'TRUE' (this app's other boolean-column convention) as true", () => {
    const row = [...SAMPLE_ROW, "TRUE"];
    const [item] = parseItemRows([HEADER_WITH_FLAG, row]);
    expect(item.allowMultipleWinners).toBe(true);
  });

  it("defaults to false when the column is blank or the row is too short to include it", () => {
    const [item] = parseItemRows([HEADER_WITH_FLAG, SAMPLE_ROW]);
    expect(item.allowMultipleWinners).toBe(false);
  });

  it("defaults to false for a real auction item with no such flag set", () => {
    const row = [...SAMPLE_ROW, "FALSE"];
    const [item] = parseItemRows([HEADER_WITH_FLAG, row]);
    expect(item.allowMultipleWinners).toBe(false);
  });
});
