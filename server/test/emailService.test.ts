/**
 * Tests server/services/emailService.ts's processEmail - previously had
 * zero test coverage of any kind (refactor-opportunities.md flagged it
 * for "a direct triple-sheet read of Bid-Management data with no
 * defensive parsing"). Investigation found the real gap was narrower
 * than "everything": the Sheets API calls themselves already propagate
 * cleanly to callers with their own try/catch (receiptRoutes.ts's
 * /email-only route, receiptService.ts's per-bidder processAllEmails
 * loop - see that file's own test) - not addressed here, out of scope.
 * The actual defensive-parsing bug was in the Bidder-Numbers row read:
 * a short/malformed row left firstName/lastName/email as `undefined`
 * rather than blank, so a sent email's subject/greeting would literally
 * read "undefined undefined" - fixed with an `|| ''` fallback, pinned
 * below alongside the normal happy-path and not-found error cases.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState } from "./handlers";
import { processEmail } from "../services/emailService";
import { getAuthenticatedClient } from "../services/oauth";

const BIDDER_NUMBERS_ROWS = [
  ["ID", "First Name", "Last Name", "Email", "", "", "", "", "", "Invoice URL"],
  ["101", "Alice", "One", "alice@example.com", "", "", "", "", "", "https://paypal.com/invoice/101"],
];

// Column-pair bid grid: header holds bidder IDs in pairs (col 0/2), two
// filler rows, then data starts row 3 - matches the real Bid-Management
// layout parseBidGrid/emailService.ts both assume.
const BID_MANAGEMENT_ROWS = [
  ["101", "", "102", ""],
  ["filler", "filler", "filler", "filler"],
  ["filler", "filler", "filler", "filler"],
  ["item1", "$50.00", "", ""],
  ["item2", "$25.00", "", ""],
];

const AUCTION_ITEMS_ROWS = [
  ["Item Number", "Category", "Item Name"],
  ["item1", "Food", "Pizza Night"],
  ["item2", "Art", "Painting Class"],
];

function mockSheets(overrides: { bidderNumbers?: string[][]; bidManagement?: string[][]; auctionItems?: string[][] } = {}) {
  const bidderNumbers = overrides.bidderNumbers ?? BIDDER_NUMBERS_ROWS;
  const bidManagement = overrides.bidManagement ?? BID_MANAGEMENT_ROWS;
  const auctionItems = overrides.auctionItems ?? AUCTION_ITEMS_ROWS;

  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.includes("Bidder-Numbers")) return HttpResponse.json({ values: bidderNumbers });
      if (url.pathname.includes("Bid-Management")) return HttpResponse.json({ values: bidManagement });
      if (url.pathname.includes("Auction-Items")) return HttpResponse.json({ values: auctionItems });
      return HttpResponse.json({ values: [] });
    })
  );
}

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000,
};
const fakeClient = getAuthenticatedClient(mockTokens);

describe("emailService.processEmail", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it("sends the receipt email for a bidder with real won items", async () => {
    mockSheets();

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id");

    expect(result).toEqual({ success: true });
  });

  it("returns a clean error when the bidder has no email on file", async () => {
    mockSheets({ bidderNumbers: [BIDDER_NUMBERS_ROWS[0], ["101", "Alice", "One", "", "", "", "", "", "", ""]] });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id");

    expect(result).toEqual({ success: false, error: "No email address found for this bidder." });
  });

  it("returns a clean error when the bidder isn't in the Bid-Management matrix", async () => {
    mockSheets({ bidManagement: [["999", "", "102", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]] });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id");

    expect(result).toEqual({ success: false, error: "Bidder not found in Bid-Management matrix." });
  });

  it("returns a clean error when the bidder won no items", async () => {
    mockSheets({ bidManagement: [["101", "", "102", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]] });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id");

    expect(result).toEqual({ success: false, error: "No items won for this bidder." });
  });

  it("falls back to blank name/invoice fields instead of the literal string 'undefined'/'null' for a malformed Bidder-Numbers row", async () => {
    // firstName/lastName/invoiceUrl cells missing from this row entirely
    // (MSW's JSON serialization turns the `undefined` array slots below
    // into `null`, matching how any unexpectedly-shaped API response
    // would arrive as parsed JSON) - without the `|| ''` fallback, the
    // sent email's subject/greeting would literally read "undefined
    // undefined" or "null null" instead of degrading to a blank name.
    mockSheets({ bidderNumbers: [BIDDER_NUMBERS_ROWS[0], ["101", undefined as any, undefined as any, "alice@example.com"]] });

    let sentRaw = "";
    server.use(
      http.post("https://gmail.googleapis.com/gmail/v1/users/:userId/messages/send", async ({ request }) => {
        const body = await request.json() as { raw: string };
        sentRaw = body.raw;
        return HttpResponse.json({ id: "mock-message-id", labelIds: ["SENT"] });
      })
    );

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id");

    expect(result).toEqual({ success: true });
    const decoded = Buffer.from(sentRaw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    expect(decoded).not.toContain("undefined");
    expect(decoded).not.toContain("null");
  });
});
