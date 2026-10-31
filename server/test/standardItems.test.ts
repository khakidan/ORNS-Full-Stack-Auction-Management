/**
 * The items every auction sells at a fixed price (standardItems.ts): seeded
 * each year, and put back by Set Up and Go Live if one went missing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let fake: any;
vi.mock("../utils/googleClients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/googleClients")>()),
  sheetsFor: () => fake,
}));

import { STANDARD_ITEMS, standardItemRows, planStandardItems, ensureStandardItems, ensureStandardItemsFor } from "../services/standardItems";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { _resetConfigCacheForTesting } from "../services/configService";
import { logAction } from "../services/actionLog";

const HEADER = ["Item Number", "Category", "Name", "Description", "Value", "Opening Bid", "Min Raise", "Donor", "Type", "Status", "Bundle", "Bundled", "Allow Multiple Winners"];
const everyStandardRow = (ticketPrice = "35") => standardItemRows(ticketPrice).map((r) => r.map(String));

function fakeSheets(rows: unknown[][]) {
  return {
    spreadsheets: {
      values: {
        get: vi.fn(async () => ({ data: { values: rows } })),
        append: vi.fn(async () => ({})),
        batchUpdate: vi.fn(async () => ({})),
      },
    },
  } as any;
}

describe("standardItemRows", () => {
  it("lists the 11 items with their prices in Value, the ticket price for Auction Tickets, all Active and allowing several winners", () => {
    const rows = standardItemRows("35");
    expect(rows.map((r) => [r[0], r[2], r[4]])).toEqual([
      ["1401", "A Night with the ORNS Staff", "30"],
      ["1501", "One Raffle Ticket for a $500 Amazon Gift Card", "5"],
      ["1502", "Five Raffle Tickets for a $500 Amazon Gift Card", "15"],
      ["1503", "Ten Raffle Tickets for a $500 Amazon Gift Card", "30"],
      ["1504", "One 50/50 Raffle Ticket", "20"],
      ["1601", "Open Appeal for $500", "500"],
      ["1602", "Open Appeal for $250", "250"],
      ["1603", "Open Appeal for $100", "100"],
      ["1604", "Open Appeal for $50", "50"],
      ["1605", "Open Appeal for $25", "25"],
      ["1701", "Auction Tickets", "35"],
    ]);
    for (const row of rows) {
      expect(row[5]).toBe("");
      expect(row[6]).toBe("");
      expect(row[9]).toBe("Active");
      expect(row[12]).toBe(true);
    }
  });
});

describe("planStandardItems", () => {
  it("adds nothing when every item is there", () => {
    expect(planStandardItems([HEADER, ...everyStandardRow()], "35")).toEqual({ append: [], multipleWinnersRows: [], blankPriceRows: [] });
  });

  it("adds a missing item with its own ID", () => {
    const rows = [HEADER, ...everyStandardRow().filter((r) => r[0] !== "1603")];
    expect(planStandardItems(rows, "35").append.map((r) => [r[0], r[2], r[4]])).toEqual([["1603", "Open Appeal for $100", "100"]]);
  });

  it("finds an item by name after its ID moved, and keeps an organizer's edits to it", () => {
    // 1502 was deleted, so the old 1503 is now 1502 - with a new price.
    const rows = [HEADER, ...everyStandardRow().filter((r) => r[0] !== "1502").map((r) => (r[0] === "1503" ? ["1502", r[1], r[2], "", "$35"] : r))];
    const { append } = planStandardItems(rows, "35");
    // Only "Five Raffle Tickets" is missing; its ID 1502 is taken, so it takes the next free one in the 1500s.
    expect(append.map((r) => [r[0], r[2]])).toEqual([["1503", "Five Raffle Tickets for a $500 Amazon Gift Card"]]);
  });

  it("counts last season's 50/50 wording as the same item", () => {
    const rows = [HEADER, ...everyStandardRow().map((r) => (r[0] === "1504" ? [...r.slice(0, 2), "One 50/50 Raffle Ticket $20", ...r.slice(3)] : r))];
    expect(planStandardItems(rows, "35").append).toEqual([]);
  });

  it("keeps the Auction Tickets Value at the ticket price", () => {
    const rows = [HEADER, ...everyStandardRow("30")];
    expect(planStandardItems(rows, "35").ticketPriceRow).toEqual({ rowNumber: 12, from: "30" });
    expect(planStandardItems(rows, "$30.00").ticketPriceRow).toBeUndefined();
    // No ticket price set: leave it.
    expect(planStandardItems(rows, "").ticketPriceRow).toBeUndefined();
  });

  it("turns Allow Multiple Winners back on for a standard item that lost it - Movie Night and Auction Tickets included", () => {
    const rows = [HEADER, ...everyStandardRow().map((r) => (r[0] === "1401" || r[0] === "1701" ? [...r.slice(0, 12), "FALSE"] : r))];
    expect(planStandardItems(rows, "35").multipleWinnersRows).toEqual([
      { rowNumber: 2, label: "1401 A Night with the ORNS Staff" },
      { rowNumber: 12, label: "1701 Auction Tickets" },
    ]);
  });

  it("a row whose ID moved to another standard item doesn't count as this one", () => {
    // Ten Raffle Tickets now has 1502; Five Raffle Tickets is gone.
    const rows = [HEADER, ...everyStandardRow().filter((r) => r[0] !== "1502").map((r) => (r[0] === "1503" ? ["1502", ...r.slice(1)] : r))];
    expect(planStandardItems(rows, "35").append.map((r) => r[2])).toEqual(["Five Raffle Tickets for a $500 Amazon Gift Card"]);
  });

  it("an organizer's renamed item keeps its place by ID and category", () => {
    const rows = [HEADER, ...everyStandardRow().map((r) => (r[0] === "1401" ? [r[0], r[1], "Movie Night with the Staff", ...r.slice(3)] : r))];
    expect(planStandardItems(rows, "35").append).toEqual([]);
  });

  it("fills in a blank price, but keeps one an organizer typed", () => {
    const rows = [HEADER, ...everyStandardRow().map((r) => (r[0] === "1501" ? [...r.slice(0, 4), "", ...r.slice(5)] : r[0] === "1502" ? [...r.slice(0, 4), "$18", ...r.slice(5)] : r))];
    expect(planStandardItems(rows, "35").blankPriceRows).toEqual([{ rowNumber: 3, label: "1501 One Raffle Ticket for a $500 Amazon Gift Card", price: "5" }]);
  });

  it("fills an empty list completely", () => {
    expect(planStandardItems([HEADER], "35").append).toHaveLength(STANDARD_ITEMS.length);
  });
});

describe("ensureStandardItems", () => {
  it("appends what's missing and sets the ticket price, as typed (USER_ENTERED)", async () => {
    const sheets = fakeSheets([HEADER, ...everyStandardRow("30").filter((r) => r[0] !== "1401")]);

    const result = await ensureStandardItems(sheets, "items", "35");

    expect(result).toEqual({ added: ["1401 A Night with the ORNS Staff"], ticketPrice: { from: "30", to: "35" } });
    // The price edit goes before the append, while row 11 is still Auction Tickets.
    expect(sheets.spreadsheets.values.batchUpdate.mock.invocationCallOrder[0]).toBeLessThan(sheets.spreadsheets.values.append.mock.invocationCallOrder[0]);
    expect(sheets.spreadsheets.values.append).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: "items", range: "'Auction-Items'!A:M", valueInputOption: "USER_ENTERED",
      requestBody: { values: [["1401", "Movie Night", "A Night with the ORNS Staff", "", "30", "", "", "", "", "Active", "", "", true]] },
    }));
    expect(sheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: { valueInputOption: "USER_ENTERED", data: [{ range: "'Auction-Items'!E11", values: [["35"]] }] },
    }));
  });

  it("writes nothing when all is in place", async () => {
    const sheets = fakeSheets([HEADER, ...everyStandardRow()]);
    expect(await ensureStandardItems(sheets, "items", "35")).toEqual({ added: [] });
    expect(sheets.spreadsheets.values.append).not.toHaveBeenCalled();
    expect(sheets.spreadsheets.values.batchUpdate).not.toHaveBeenCalled();
  });
});

describe("ensureStandardItemsFor (Set Up, Go Live)", () => {
  const req = { user: { email: "admin@orns.org", role: "admin" } } as any;
  beforeEach(async () => {
    vi.mocked(logAction).mockClear();
    _resetConfigCacheForTesting();
    await getAdminFirestore().collection("settings").doc("global").set({ auctionItemsSpreadsheetId: "items", ticketPrice: "35" });
  });

  it("records what it put back in Action History and tells staff", async () => {
    fake = fakeSheets([HEADER, ...everyStandardRow().filter((r) => r[0] !== "1605")]);

    const { message } = await ensureStandardItemsFor(req);

    expect(message).toBe("Put back 1 missing standard item(s): 1605 Open Appeal for $25.");
    expect(logAction).toHaveBeenCalledWith(req, expect.objectContaining({ area: "Auction Items", action: "Check standard items" }));
  });

  it("says nothing and records nothing when all is in place", async () => {
    fake = fakeSheets([HEADER, ...everyStandardRow()]);
    expect(await ensureStandardItemsFor(req)).toEqual({});
    expect(logAction).not.toHaveBeenCalled();
  });

  it("never fails the request: a read error becomes a message for staff", async () => {
    fake = fakeSheets([]);
    fake.spreadsheets.values.get.mockRejectedValue(new Error("quota"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await ensureStandardItemsFor(req)).message).toMatch(/Couldn't check the standard items.*quota/);
    vi.mocked(console.warn).mockRestore();
  });

  it("does nothing before the Auction Items spreadsheet is set", async () => {
    await getAdminFirestore().collection("settings").doc("global").set({ ticketPrice: "35" });
    _resetConfigCacheForTesting();
    fake = fakeSheets([]);
    expect(await ensureStandardItemsFor(req)).toEqual({});
    expect(fake.spreadsheets.values.get).not.toHaveBeenCalled();
  });
});
