/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_AuctionItemManager.gs's
 * `getItemName` - this used to read a local, one-time-snapshot copy of the
 * Items spreadsheet living inside Bid Management (3 columns, Active-only,
 * written once by "Set Up Bid Management App" and never updated again), so
 * an item added, renamed, or deactivated afterward silently never showed
 * up on printed receipts or PayPal invoice line items. It now opens the
 * real Auction Items spreadsheet live by ID (`this.config['auctionImportSheetID']`,
 * already loaded from this spreadsheet's own _Settings tab) instead - see
 * docs/agents/CHANGELOG.md's Code Hardening item #1 and
 * CHANGELOG.md for the full history. Mirrors
 * scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_BidderManager.gs's
 * own earlier cross-spreadsheet-read precedent (hard error on a missing ID
 * or an empty cross-read; soft fallback for one unmatched record).
 *
 * Loaded via helpers/loadGasClass, not a Node reimplementation, so these
 * tests exercise the actual .gs source.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";
import { FakeSpreadsheet } from "./helpers/fakeSheet";

const { AuctionItemManager } = loadGasClasses(
  [
    "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/00_Class_GlobalVariables.gs",
    "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_AuctionItemManager.gs",
  ],
  ["AuctionItemManager"]
);

// Items-spreadsheet schema (Class_AuctionItem.gs): id, category, name, ...
const ITEMS_ROWS = [
  ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical/Cert", "Status", "Bundle ID", "Bundled Date/Time"],
  ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
  ["1503", "Raffle", "One 50/50 Raffle Ticket $20", "", "", "", "", "", "", "Active", "", ""],
];

function fakeItemsSpreadsheet(rows: any[][] = ITEMS_ROWS, sheetName = "Auction-Items") {
  const ss = new FakeSpreadsheet();
  ss.addSheet(sheetName, rows);
  return ss;
}

function makeManager(overrides: { itemsSpreadsheet?: any; config?: any } = {}) {
  return new AuctionItemManager({
    activeSpreadSheet: new FakeSpreadsheet(),
    config: overrides.config ?? { auctionImportSheetID: "items-ss-id" },
    itemsSpreadsheet: overrides.itemsSpreadsheet ?? fakeItemsSpreadsheet(),
  });
}

describe("AuctionItemManager.getItemName", () => {
  it("looks up a real item's name from the live Items spreadsheet", () => {
    const mgr = makeManager();
    expect(mgr.getItemName("801")).toBe("Pizza Night");
  });

  it("normalizes numeric-looking IDs the same way as string IDs", () => {
    const mgr = makeManager();
    expect(mgr.getItemName(1503)).toBe("One 50/50 Raffle Ticket $20");
    expect(mgr.getItemName("1503")).toBe("One 50/50 Raffle Ticket $20");
  });

  it("returns 'Unknown Item' for an ID that isn't in the (successfully read) Items spreadsheet", () => {
    const mgr = makeManager();
    expect(mgr.getItemName("9999")).toBe("Unknown Item");
  });

  it("falls back to the workbook's first tab when no sheet is named 'Auction-Items'", () => {
    const ss = fakeItemsSpreadsheet(ITEMS_ROWS, "Imported Items");
    const mgr = makeManager({ itemsSpreadsheet: ss });
    expect(mgr.getItemName("801")).toBe("Pizza Night");
  });

  it("throws a real, actionable error when auctionImportSheetID is missing", () => {
    // No itemsSpreadsheet override AND no config key - loadItemNameMap_
    // must throw before ever attempting SpreadsheetApp.openById(undefined).
    const mgr = new AuctionItemManager({ activeSpreadSheet: new FakeSpreadsheet(), config: {} });
    expect(() => mgr.getItemName("801")).toThrow(/Missing the Auction Items spreadsheet ID/);
  });

  it("throws a real, actionable error when the cross-read comes back empty", () => {
    const mgr = makeManager({ itemsSpreadsheet: fakeItemsSpreadsheet([["Item Number", "Category", "Item Name"]]) });
    expect(() => mgr.getItemName("801")).toThrow(/no item data/);
  });

  it("caches the name map after the first lookup instead of re-reading the spreadsheet every call", () => {
    const ss = fakeItemsSpreadsheet();
    const mgr = makeManager({ itemsSpreadsheet: ss });

    expect(mgr.getItemName("801")).toBe("Pizza Night");

    // Mutate the underlying sheet directly - if getItemName re-read the
    // spreadsheet on every call, this would flip the result; a real cache
    // means the second call still sees the original data.
    const sheet = ss.getSheetByName("Auction-Items")!;
    (sheet as any).data[1][2] = "Renamed Item";

    expect(mgr.getItemName("801")).toBe("Pizza Night");
  });
});
