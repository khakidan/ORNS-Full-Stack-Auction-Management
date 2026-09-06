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
});
