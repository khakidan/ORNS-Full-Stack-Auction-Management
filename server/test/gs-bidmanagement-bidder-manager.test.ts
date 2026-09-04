/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_BidderManager.gs's
 * `_collectGuestInfo_`/`_collectGuestTickets_` - the logic
 * `copyBiddersToBidderSheet()` (the "Set Up Bid Management App" sync) uses
 * to decide which ticket-purchase guests get their own row in
 * Bidder-Numbers, and therefore their own printed bidder-number label.
 *
 * User-reported bug: a guest with a real name/email who explicitly opted
 * in for their own bidder number ("yes" in their own-bidder-number column)
 * still never got a label. Root cause: `_collectGuestInfo_` required a
 * SEPARATE "guest marker" checkbox (column index 6) to also be non-blank
 * before even looking at the guest's own name or opt-in answer - a column
 * the Node-side equivalent (server/services/syncService.ts's
 * collectGuestInfo, and further upstream, src/lib/attendeeParsing.ts's own
 * guest-inclusion check) never required. A guest whose row simply never
 * had that separate checkbox ticked was silently dropped, even though
 * they were visibly listed with an "Own #" badge in the live app. Fixed in
 * both places; this file is the .gs-side regression guard - see
 * server/test/tickets.test.ts for the equivalent Node-side one.
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

const { BidderManager } = loadGasClasses(
  [
    "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GlobalVariables.gs",
    "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_UIStrings.gs",
    "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_UIManager.gs",
    "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_BidderManager.gs",
  ],
  ["BidderManager"]
);

/**
 * Builds a BidderManager with a fully injected, real active spreadsheet
 * and a fake external tickets spreadsheet holding a "tickets" sheet with
 * `rows` as its data (header row required, content arbitrary since
 * _getTicketPackage always skips row 1).
 */
function makeManager(rows: any[][]) {
  const activeSpreadSheet = new FakeSpreadsheet();
  const ticketsSpreadsheet = new FakeSpreadsheet();
  ticketsSpreadsheet.addSheet("tickets", [["Header"], ...rows]);

  const manager = new BidderManager({
    activeSpreadSheet,
    config: {},
    ticketsSpreadsheet,
  });
  manager.collectedBidders = [];
  return manager;
}

// Column layout matches attendeeParsing.ts/syncService.ts's own: 0 first,
// 1 last, 2 email, 3-5 unused here, 6 "guest marker" checkbox, 7/8/9 guest
// 1 first/last/email, 10 guest 1 own-number flag.
function ticketRow(overrides: Record<number, any> = {}) {
  const row = new Array(11).fill("");
  Object.entries(overrides).forEach(([i, v]) => { row[Number(i)] = v; });
  return row;
}

describe("BidderManager._collectGuestTickets_ / _collectGuestInfo_", () => {
  it("collects a guest 1 with a real name/email who opted in, even when the separate 'guest marker' column (index 6) is blank - the exact reported bug", () => {
    const row = ticketRow({ 0: "Dan", 1: "Sage", 2: "dan@example.com", 6: "", 7: "Jimmy", 8: "Smith", 9: "smith@smith.com", 10: "yes" });
    const manager = makeManager([row]);

    manager._collectGuestTickets_();

    expect(manager.collectedBidders).toEqual([["Jimmy", "Smith", "smith@smith.com"]]);
  });

  it("still collects a guest 1 when the guest marker column IS set (the previously-passing case, unaffected by the fix)", () => {
    const row = ticketRow({ 0: "Dan", 1: "Sage", 2: "dan@example.com", 6: "Has Guest", 7: "Jimmy", 8: "Smith", 9: "smith@smith.com", 10: "yes" });
    const manager = makeManager([row]);

    manager._collectGuestTickets_();

    expect(manager.collectedBidders).toEqual([["Jimmy", "Smith", "smith@smith.com"]]);
  });

  it("excludes a guest with a real name who did NOT opt in for their own number", () => {
    const row = ticketRow({ 0: "Dan", 1: "Sage", 7: "Jimmy", 8: "Smith", 9: "smith@smith.com", 10: "no" });
    const manager = makeManager([row]);

    manager._collectGuestTickets_();

    expect(manager.collectedBidders).toEqual([]);
  });

  it("excludes an empty guest slot (no name) even if the own-number column somehow has a stray 'yes'", () => {
    const row = ticketRow({ 0: "Dan", 1: "Sage", 10: "yes" });
    const manager = makeManager([row]);

    manager._collectGuestTickets_();

    expect(manager.collectedBidders).toEqual([]);
  });

  it("collects guests 2 and 3 from their own shifted columns, independently of guest 1's opt-in status", () => {
    const row = ticketRow({
      0: "Dan", 1: "Sage",
      // guest 1: no name at all
      // guest 2 (cols 11/12/13, own-flag 14)
      11: "Amy", 12: "Sedaris", 13: "sedaris@gmail.com", 14: "yes",
      // guest 3 (cols 15/16/17, own-flag 18)
      15: "Hue", 16: "Tint", 17: "afdhkj@gjlkadfs.com", 18: "no",
    });
    const manager = makeManager([row]);

    manager._collectGuestTickets_();

    expect(manager.collectedBidders).toEqual([["Amy", "Sedaris", "sedaris@gmail.com"]]);
  });

  it("collects all three guests together when every slot opted in, matching the user's exact reported row (Jimmy, Amy both Own #, Hue Tint not)", () => {
    const row = ticketRow({
      0: "Dan", 1: "Sage", 2: "dan@example.com",
      7: "Jimmy", 8: "Smith", 9: "smith@smith.com", 10: "yes",
      11: "Amy", 12: "Sedaris", 13: "sedaris@gmail.com", 14: "yes",
      15: "Hue", 16: "Tint", 17: "afdhkj@gjlkadfs.com", 18: "no",
    });
    const manager = makeManager([row]);

    manager._collectGuestTickets_();

    expect(manager.collectedBidders).toEqual([
      ["Jimmy", "Smith", "smith@smith.com"],
      ["Amy", "Sedaris", "sedaris@gmail.com"],
    ]);
  });
});
