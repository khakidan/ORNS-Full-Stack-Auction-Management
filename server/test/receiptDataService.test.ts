/**
 * Tests server/services/receiptDataService.ts - the single shared
 * implementation of "resolve a bidder's winning items and total" that
 * replaced the duplicate logic previously hand-written twice: once in
 * emailService.ts (for the emailed receipt - see emailService.test.ts,
 * unaffected by this refactor) and once in
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_ReceiptManager.gs's
 * `findBidderColInBidSheet_`/`buildReceipt_` (for the printed/PDF receipt
 * and PayPal invoice, now removed - see refactor-opportunities.md's Code
 * Hardening item #2 / CHANGELOG.md).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAuthenticatedClient } from "../services/oauth";
import { resetHandlersState } from "./handlers";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { buildBidderReceipt, buildAllBidderReceipts, findBidderColumn, buildItemNameLookup, resolveWonItems } from "../services/receiptDataService";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000,
};
const fakeClient = getAuthenticatedClient(mockTokens);

const BID_MANAGEMENT_ROWS = [
  ["101", "", "102", ""],
  ["filler", "filler", "filler", "filler"],
  ["filler", "filler", "filler", "filler"],
  ["801", "50", "803", "25"],
];

const BIDDER_NUMBERS_ROWS = [
  ["ID", "First Name", "Last Name", "Email"],
  ["101", "Alice", "One", "alice@example.com"],
  ["102", "Zed", "Last", "zed@example.com"],
];

const AUCTION_ITEMS_ROWS = [
  ["Item Number", "Category", "Item Name"],
  ["801", "Food", "Pizza Night"],
  ["803", "Food", "Sushi Dinner"],
];

function mockSheets(overrides: { bidManagement?: any[][]; bidderNumbers?: any[][]; auctionItems?: any[][] } = {}) {
  const bidManagement = overrides.bidManagement ?? BID_MANAGEMENT_ROWS;
  const bidderNumbers = overrides.bidderNumbers ?? BIDDER_NUMBERS_ROWS;
  const auctionItems = overrides.auctionItems ?? AUCTION_ITEMS_ROWS;

  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.includes("Bid-Management")) return HttpResponse.json({ values: bidManagement });
      if (url.pathname.includes("Bidder-Numbers")) return HttpResponse.json({ values: bidderNumbers });
      if (url.pathname.includes("Auction-Items")) return HttpResponse.json({ values: auctionItems });
      return HttpResponse.json({ values: [] });
    })
  );
}

describe("resolveWonItems / findBidderColumn / buildItemNameLookup (pure helpers)", () => {
  it("findBidderColumn finds a bidder's column, scanning header pairs", () => {
    expect(findBidderColumn(BID_MANAGEMENT_ROWS, "101")).toBe(0);
    expect(findBidderColumn(BID_MANAGEMENT_ROWS, "102")).toBe(2);
    expect(findBidderColumn(BID_MANAGEMENT_ROWS, "999")).toBe(-1);
  });

  it("resolveWonItems reads rows 3+ for the given column, resolving names via the lookup", () => {
    const getItemName = buildItemNameLookup(AUCTION_ITEMS_ROWS);

    expect(resolveWonItems(BID_MANAGEMENT_ROWS, 0, getItemName)).toEqual({
      itemsWon: ["801"],
      itemNames: ["Pizza Night"],
      itemPrices: [50],
      totalCost: 50,
    });
    // A second bidder's column (2) in the same row must resolve
    // independently, not bleed into the first bidder's items.
    expect(resolveWonItems(BID_MANAGEMENT_ROWS, 2, getItemName)).toEqual({
      itemsWon: ["803"],
      itemNames: ["Sushi Dinner"],
      itemPrices: [25],
      totalCost: 25,
    });
  });

  it("buildItemNameLookup falls back to 'Unknown Item' for an unmatched ID", () => {
    const getItemName = buildItemNameLookup(AUCTION_ITEMS_ROWS);
    expect(getItemName("9999")).toBe("Unknown Item");
  });
});

describe("buildBidderReceipt", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("resolves a full receipt for a bidder with winning items", async () => {
    mockSheets();

    const result = await buildBidderReceipt(fakeClient, "bm-id", "items-id", "101");

    expect(result).toEqual({
      success: true,
      receipt: {
        bidId: "101",
        firstName: "Alice",
        lastName: "One",
        email: "alice@example.com",
        itemsWon: ["801"],
        itemNames: ["Pizza Night"],
        itemPrices: [50],
        totalCost: 50,
      },
    });
  });

  it("returns a clean error when the bidder isn't in Bidder-Numbers", async () => {
    mockSheets();
    const result = await buildBidderReceipt(fakeClient, "bm-id", "items-id", "999");
    expect(result).toEqual({ success: false, error: "Bidder ID 999 not found in the Bidder-Numbers sheet." });
  });

  it("returns a clean error when the bidder isn't in the Bid-Management matrix", async () => {
    mockSheets({ bidManagement: [["999", "", "", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]] });
    const result = await buildBidderReceipt(fakeClient, "bm-id", "items-id", "101");
    expect(result).toEqual({ success: false, error: "Bidder ID not found in matrix." });
  });

  it("returns a clean error when the bidder won no items", async () => {
    mockSheets({ bidManagement: [["101", "", "", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]] });
    const result = await buildBidderReceipt(fakeClient, "bm-id", "items-id", "101");
    expect(result).toEqual({ success: false, error: "No items won." });
  });
});

describe("buildAllBidderReceipts", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("builds every bidder's receipt, sorted ascending by last name", async () => {
    mockSheets();

    const receipts = await buildAllBidderReceipts(fakeClient, "bm-id", "items-id");

    // Sorted by last name, not first name or column order - "Last" < "One"
    // alphabetically, so Zed Last comes first despite the first name "Zed".
    expect(receipts.map(r => `${r.firstName} ${r.lastName}`)).toEqual(["Zed Last", "Alice One"]);
    expect(receipts[0]).toEqual({
      bidId: "102",
      firstName: "Zed",
      lastName: "Last",
      email: "zed@example.com",
      itemsWon: ["803"],
      itemNames: ["Sushi Dinner"],
      itemPrices: [25],
      totalCost: 25,
    });
  });

  it("skips a bidder with no column in the Bid-Management matrix", async () => {
    mockSheets({ bidderNumbers: [BIDDER_NUMBERS_ROWS[0], ["999", "Ghost", "Person", "ghost@example.com"]] });
    const receipts = await buildAllBidderReceipts(fakeClient, "bm-id", "items-id");
    expect(receipts).toEqual([]);
  });

  it("skips a bidder with a column but no winning items", async () => {
    mockSheets({
      bidManagement: [["101", "", "", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]],
      bidderNumbers: [BIDDER_NUMBERS_ROWS[0], BIDDER_NUMBERS_ROWS[1]],
    });
    const receipts = await buildAllBidderReceipts(fakeClient, "bm-id", "items-id");
    expect(receipts).toEqual([]);
  });

  it("skips a blank bidder-ID row without throwing", async () => {
    mockSheets({ bidderNumbers: [BIDDER_NUMBERS_ROWS[0], ["", "", "", ""], BIDDER_NUMBERS_ROWS[1]] });
    const receipts = await buildAllBidderReceipts(fakeClient, "bm-id", "items-id");
    expect(receipts.map(r => r.bidId)).toEqual(["101"]);
  });
});
