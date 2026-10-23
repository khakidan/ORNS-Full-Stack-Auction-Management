/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItem.gs's
 * display-fallback helpers and its `fromData` static factory (Code
 * Hardening item #3) - the shared data layer every one of the 8 api*
 * document-generation bridge functions consumes. Loaded via
 * helpers/loadGasClass, not a Node reimplementation.
 *
 * `Class_AuctionItemManager.gs` (this file used to also test its
 * `getValidSortedItems`) is deleted - Node now resolves the valid/sorted
 * item list itself (see server/test/itemDataService.test.ts) and hands
 * it to GAS as a parameter. See docs/agents/CHANGELOG.md's
 * Code Hardening item #3 / CHANGELOG.md.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";

const { AuctionItem } = loadGasClasses(
  ["scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItem.gs"],
  ["AuctionItem"]
);

function itemRow(id: string, overrides: Record<number, any> = {}) {
  const row = [id, "Food", `Item ${id}`, "A description", "100", "50", "5", "A Donor", "Physical Item", "Active", "", ""];
  Object.entries(overrides).forEach(([i, v]) => { row[Number(i)] = v; });
  return row;
}

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

  it("defaults missing trailing cells to '' instead of undefined for a genuinely short row", () => {
    // The Sheets API omits trailing empty cells from a row, so a row with
    // no bundle/timestamp data (or any other blank trailing columns) can
    // arrive shorter than 12 elements - not itemRow()'s always-12-element
    // fixture, which never exercises this path. Missing cells must
    // default to '', not undefined, or the `=== ''` fallback checks below
    // silently break.
    const idOnly = new AuctionItem(["101"]);

    expect(idOnly.id).toBe("101");
    expect(idOnly.category).toBe("");
    expect(idOnly.bundleID).toBe("");
    expect(idOnly.bundleTimeStamp).toBe("");

    expect(idOnly.getDisplayValue()).toBe("500");
    expect(idOnly.getDisplayOpeningBid()).toBe("5");
    expect(idOnly.getDisplayMinRaise()).toBe("5");
    expect(idOnly.hasOpeningBid()).toBe(false);
  });
});

describe("AuctionItem.fromData", () => {
  it("reconstructs a real AuctionItem instance from Node's resolved item shape", () => {
    const item = AuctionItem.fromData({
      id: "301",
      category: "Retail",
      name: "Gift Card",
      description: "A card",
      value: "100",
      openingBid: "50",
      minRaise: "5",
      donor: "Acme Co.",
      itemType: "Certificate",
      status: "Active",
      bundleId: "",
      bundledDateTime: "",
    });

    expect(item).toBeInstanceOf(AuctionItem);
    expect(item.id).toBe("301");
    expect(item.category).toBe("Retail");
    expect(item.name).toBe("Gift Card");
    // Field-name translation: Node's resolver uses donor/itemType/bundleId/
    // bundledDateTime (src/types.ts's AuctionItem shape); this class uses
    // donatedBy/phyOrCert/bundleID/bundleTimeStamp.
    expect(item.donatedBy).toBe("Acme Co.");
    expect(item.phyOrCert).toBe("Certificate");
    expect(item.isLive()).toBe(false);
  });

  it("defaults missing fields to '' the same way the constructor does", () => {
    const item = AuctionItem.fromData({ id: "101" });
    expect(item.category).toBe("");
    expect(item.donatedBy).toBe("");
    expect(item.bundleID).toBe("");
    expect(item.getDisplayValue()).toBe("500");
    expect(item.hasOpeningBid()).toBe(false);
  });
});
