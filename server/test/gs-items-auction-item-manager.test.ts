/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItemManager.gs's
 * `getValidSortedItems` and Class_AuctionItem.gs's display-fallback helpers -
 * the shared data layer every one of the 8 api* document-generation bridge
 * functions reads from. Loaded via helpers/loadGasClass, not a Node
 * reimplementation.
 *
 * This is the exact layer the "Live items skip the status filter" bug lived
 * in (fixed - see CHANGELOG.md), so it's the highest-leverage place to test:
 * get this right and every generator's item selection is correct by
 * construction.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";
import { FakeSpreadsheet } from "./helpers/fakeSheet";

const { AuctionItemManager, AuctionItem } = loadGasClasses(
  [
    "scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_GlobalVariables.gs",
    "scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItem.gs",
    "scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItemManager.gs",
  ],
  ["AuctionItemManager", "AuctionItem"]
);

// Column layout (0-indexed): id, category, name, description, value,
// openingBid, minRaise, donatedBy, phyOrCert, status, bundleID, bundleTS
const HEADER = ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical/Cert", "Status", "Bundle ID", "Bundled Date/Time"];

function itemRow(id: string, overrides: Record<number, any> = {}) {
  const row = [id, "Food", `Item ${id}`, "A description", "100", "50", "5", "A Donor", "Physical Item", "Active", "", ""];
  Object.entries(overrides).forEach(([i, v]) => { row[Number(i)] = v; });
  return row;
}

function fakeManagerWithItems(rows: any[][]) {
  const spreadsheet = new FakeSpreadsheet();
  spreadsheet.addSheet("Auction-Items", [HEADER, ...rows]);
  return new AuctionItemManager({ activeSpreadSheet: spreadsheet, config: {} });
}

describe("AuctionItemManager.getValidSortedItems", () => {
  it("excludes items with status 'inactive' or 'deleted' (case/whitespace-insensitive)", () => {
    const mgr = fakeManagerWithItems([
      itemRow("101", { 9: "Active" }),
      itemRow("102", { 9: "inactive" }),
      itemRow("103", { 9: "Deleted" }),
      itemRow("104", { 9: "  DELETED  " }),
      itemRow("105", { 9: "" }), // blank status counts as valid
    ]);

    const ids = mgr.getValidSortedItems().map((i: any) => i.id);
    expect(ids).toEqual(["101", "105"]);
  });

  it("sorts numerically by ID, not lexicographically", () => {
    // Lexicographic sort would put "150" after "1301" ("1" < "1" but "3" < "5"
    // wins on the second char) - this is exactly the ordering every printed
    // document and the live-auction slideshow depends on.
    const mgr = fakeManagerWithItems([
      itemRow("1301"),
      itemRow("150"),
      itemRow("201"),
    ]);

    const ids = mgr.getValidSortedItems().map((i: any) => i.id);
    expect(ids).toEqual(["150", "201", "1301"]);
  });

  it("returns an empty array when the Auction-Items sheet doesn't exist", () => {
    const spreadsheet = new FakeSpreadsheet(); // no sheets added
    const mgr = new AuctionItemManager({ activeSpreadSheet: spreadsheet, config: {} });
    expect(mgr.getValidSortedItems()).toEqual([]);
  });

  it("returns an empty array when the sheet has only a header row", () => {
    const mgr = fakeManagerWithItems([]);
    expect(mgr.getValidSortedItems()).toEqual([]);
  });

  it("constructs real AuctionItem instances with every field populated from the row", () => {
    const mgr = fakeManagerWithItems([itemRow("301", { 1: "Retail", 2: "Gift Card", 7: "Acme Co." })]);
    const [item] = mgr.getValidSortedItems();

    expect(item.id).toBe("301");
    expect(item.category).toBe("Retail");
    expect(item.name).toBe("Gift Card");
    expect(item.donatedBy).toBe("Acme Co.");
  });
});

describe("AuctionItem display-fallback helpers", () => {
  it("isLive() is true only for the 'Live' category", () => {
    expect(new AuctionItem(itemRow("1301", { 1: "Live" })).isLive()).toBe(true);
    expect(new AuctionItem(itemRow("101", { 1: "Food" })).isLive()).toBe(false);
  });

  it("hasOpeningBid() is false only when openingBid is an empty string", () => {
    expect(new AuctionItem(itemRow("101", { 5: "" })).hasOpeningBid()).toBe(false);
    expect(new AuctionItem(itemRow("101", { 5: "50" })).hasOpeningBid()).toBe(true);
    expect(new AuctionItem(itemRow("101", { 5: "0" })).hasOpeningBid()).toBe(true);
  });

  it.each([
    ["getDisplayValue", 4, "500"],
    ["getDisplayOpeningBid", 5, "5"],
    ["getDisplayMinRaise", 6, "5"],
  ])("%s() falls back to the default when blank, and returns the real value otherwise", (method, colIndex, fallback) => {
    const blank = new AuctionItem(itemRow("101", { [colIndex]: "" }));
    const real = new AuctionItem(itemRow("101", { [colIndex]: "75" }));

    expect((blank as any)[method]()).toBe(fallback);
    expect((real as any)[method]()).toBe("75");
  });
});
