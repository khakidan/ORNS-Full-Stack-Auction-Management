/**
 * Tests server/services/itemDataService.ts's getValidSortedItems - the
 * Node port of
 * scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItemManager.gs's
 * getValidSortedItems (Code Hardening item #3), so every Items-spreadsheet
 * Doc/Slides generator can receive an already-resolved item list from
 * Node instead of reading the sheet itself. Reuses src/lib/itemParsing.ts's
 * existing, already-tested row parsing - these tests focus on the new
 * filter/sort behavior layered on top of it, not re-testing parsing itself.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { google } from "googleapis";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState } from "./handlers";
import { getAuthenticatedClient } from "../services/oauth";
import { getValidSortedItems } from "../services/itemDataService";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000,
};
const fakeClient = getAuthenticatedClient(mockTokens);
const sheets = google.sheets({ version: "v4", auth: fakeClient });

const HEADER = ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical/Cert", "Status", "Bundle ID", "Bundled Date/Time"];

function itemRow(id: string, overrides: Record<number, any> = {}) {
  const row = [id, "Food", `Item ${id}`, "A description", "100", "50", "5", "A Donor", "Physical Item", "Active", "", ""];
  Object.entries(overrides).forEach(([i, v]) => { row[Number(i)] = v; });
  return row;
}

function mockAuctionItems(rows: any[][]) {
  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.includes("Auction-Items")) return HttpResponse.json({ values: [HEADER, ...rows] });
      return HttpResponse.json({ values: [] });
    })
  );
}

beforeEach(() => {
  resetHandlersState();
});

describe("getValidSortedItems", () => {
  it("leaves out the standard items - printed documents are for items people bid on", async () => {
    mockAuctionItems([
      itemRow("101"),
      itemRow("1401", { 1: "Movie Night", 2: "A Night with the ORNS Staff" }),
      itemRow("1501", { 1: "Raffle Tickets", 2: "One Raffle Ticket for a $500 Amazon Gift Card" }),
      itemRow("1504", { 1: "Raffle Tickets", 2: "One 50/50 Raffle Ticket $20" }),
      // Renamed by an Administrator: still Open Appeal's 1601.
      itemRow("1601", { 1: "Open Appeal", 2: "Paddle Raise $500" }),
      itemRow("1701", { 1: "Auction Tickets", 2: "Auction Tickets" }),
    ]);

    const items = await getValidSortedItems(sheets, "items-ss-id");
    expect(items.map((i) => i.id)).toEqual(["101"]);
  });

  it("excludes items with status 'inactive' or 'deleted' (case/whitespace-insensitive)", async () => {
    mockAuctionItems([
      itemRow("101", { 9: "Active" }),
      itemRow("102", { 9: "inactive" }),
      itemRow("103", { 9: "Deleted" }),
      itemRow("104", { 9: "  DELETED  " }),
      itemRow("105", { 9: "" }), // blank status counts as valid
    ]);

    const items = await getValidSortedItems(sheets, "items-ss-id");
    expect(items.map((i) => i.id)).toEqual(["101", "105"]);
  });

  it("sorts numerically by ID, not lexicographically", async () => {
    // Lexicographic sort would put "150" after "1301" - this is exactly
    // the ordering every printed document and the live-auction slideshow
    // depends on.
    mockAuctionItems([
      itemRow("1301"),
      itemRow("150"),
      itemRow("201"),
    ]);

    const items = await getValidSortedItems(sheets, "items-ss-id");
    expect(items.map((i) => i.id)).toEqual(["150", "201", "1301"]);
  });

  it("returns an empty array when the sheet has only a header row", async () => {
    mockAuctionItems([]);
    const items = await getValidSortedItems(sheets, "items-ss-id");
    expect(items).toEqual([]);
  });

  it("returns an empty array when the read comes back with no values at all", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        return HttpResponse.json({});
      })
    );
    const items = await getValidSortedItems(sheets, "items-ss-id");
    expect(items).toEqual([]);
  });

  it("resolves every field populated from the row", async () => {
    mockAuctionItems([itemRow("301", { 1: "Retail", 2: "Gift Card", 7: "Acme Co." })]);
    const [item] = await getValidSortedItems(sheets, "items-ss-id");

    expect(item.id).toBe("301");
    expect(item.category).toBe("Retail");
    expect(item.name).toBe("Gift Card");
    expect(item.donor).toBe("Acme Co.");
  });

  it("requests UNFORMATTED_VALUE, not the API's FORMATTED_VALUE default (regression)", async () => {
    // Real bug: without this, currency-formatted Value/Opening Bid/Min
    // Raise cells came back as pre-formatted display strings (e.g.
    // "$1,000.00") instead of the raw number GAS's native
    // SpreadsheetApp.getValues() always returned - every Doc generator's
    // own hardcoded "$" prefix (Class_BidSheetDoc.gs's valueLabel,
    // Class_CatalogDoc.gs's `Value: $${item.value}`, etc.) then produced
    // a doubled "$" and mismatched formatting on every generated
    // document. See CHANGELOG.md.
    let capturedRenderOption: string | null = null;
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
        capturedRenderOption = new URL(request.url).searchParams.get("valueRenderOption");
        return HttpResponse.json({ values: [HEADER, itemRow("101")] });
      })
    );

    await getValidSortedItems(sheets, "items-ss-id");
    expect(capturedRenderOption).toBe("UNFORMATTED_VALUE");
  });

  it("carries a currency cell's raw number through with no '$' prefix or thousands separator", async () => {
    // UNFORMATTED_VALUE returns a genuine JSON number for a
    // currency-formatted cell, not a string - confirms parseItemRows'
    // `.toString()` handles that correctly.
    mockAuctionItems([itemRow("401", { 4: 1000, 5: 500.5, 6: 25 })]);
    const [item] = await getValidSortedItems(sheets, "items-ss-id");

    expect(item.value).toBe("1000");
    expect(item.openingBid).toBe("500.5");
    expect(item.minRaise).toBe("25");
  });
});
