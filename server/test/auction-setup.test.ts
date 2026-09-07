/**
 * Test suite for the Auction Setup workflow.
 * Covers POST /api/auction/setup-new specifically.
 * Features full auction setup, Google Drive folder creation, and template copying.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, clearedRanges, sheetBatchUpdateRequests, lastBulkWritePayload, bundleWritePayload } from "./handlers";
import { AUCTION_TICKETS_ITEM_ID } from "../utils/categoryHelpers";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

describe("setupRoutes - /api/auction/setup-new", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await request(app).post("/api/auction/setup-new");
    expect(response.status).toBe(401);
  });

  it("handles the happy path: full auction setup setup", async () => {
    // setup-new returns a stream of NDJSON
    const response = await request(app)
      .post("/api/auction/setup-new")
      .set(authHeader)
      .send({
        ticketsSpreadsheetId: "s1",
        itemEntrySpreadsheetId: "s2",
        bidManagementSpreadsheetId: "s3"
      });

    expect(response.status).toBe(200);
    expect(response.get("Content-Type")).toContain("application/x-ndjson");

    // Parse NDJSON response
    const lines = response.text.trim().split("\n");
    const results = lines.map(line => JSON.parse(line));

    expect(results).toContainEqual(expect.objectContaining({ log: expect.stringContaining("Starting setup") }));
    expect(results).toContainEqual(expect.objectContaining({ success: true }));
  });

  it("returns 400 for missing required spreadsheet IDs", async () => {
    const response = await request(app)
      .post("/api/auction/setup-new")
      .set(authHeader)
      .send({}); // Empty body

    expect(response.status).toBe(400);
    // We parse the text since it might stay NDJSON
    const body = response.body.error ? response.body : JSON.parse(response.text);
    expect(body.error).toContain("Missing required spreadsheet IDs");
  });

  it("halts if the auction folder already exists", async () => {
    // Use fake timers to control Date
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-01T00:00:00Z")); // Dec 2026 -> setup for 2027

    // Override Drive List to show existing folder for 2027
    server.use(
      http.get('https://www.googleapis.com/drive/v3/files', () => {
        return HttpResponse.json({
          files: [{ id: "existing-id", name: "2027 Auction", mimeType: "application/vnd.google-apps.folder" }]
        });
      })
    );

    const response = await request(app)
      .post("/api/auction/setup-new")
      .set(authHeader)
      .send({
        ticketsSpreadsheetId: "s1",
        itemEntrySpreadsheetId: "s2",
        bidManagementSpreadsheetId: "s3"
      });

    const lines = response.text.trim().split("\n");
    const results = lines.map(line => JSON.parse(line));
    
    expect(results).toContainEqual(expect.objectContaining({
      error: expect.stringContaining("already exists")
    }));

    vi.useRealTimers();
  });

  describe("master spreadsheet reset (destructive step)", () => {
    // The default mocked spreadsheets.get (handlers.ts) only lists
    // Bidder-Numbers/Bid-Management/Auction-Status/tickets - so every test
    // in this block overrides it with the two deletable tabs plus a
    // leftover "Auction-Items" tab (a stale copy a pre-fix Bid Management
    // spreadsheet might still have lying around - see
    // docs/agents/refactor-opportunities.md's Code Hardening item #1 /
    // CHANGELOG.md, since performSheetSync no longer creates this sheet at
    // all) plus two tabs that must NOT be deleted (Auction-Status,
    // tickets), to pin the "only the right tabs, and no longer Auction-Items" behavior.
    const bidManagementSheetsMetadata = () =>
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId', () => {
        return HttpResponse.json({
          sheets: [
            { properties: { title: "Auction-Items", sheetId: 105 } },
            { properties: { title: "Bid-Management", sheetId: 102 } },
            { properties: { title: "Bidder-Numbers", sheetId: 101 } },
            { properties: { title: "Auction-Status", sheetId: 103 } },
            { properties: { title: "tickets", sheetId: 104 } }
          ]
        });
      });

    it("deletes exactly the Bid-Management/Bidder-Numbers tabs (leaving a leftover Auction-Items tab alone), resets Auction-Status, and clears Special-Winners/Follow-Up - nothing else", async () => {
      server.use(bidManagementSheetsMetadata());

      const response = await request(app)
        .post("/api/auction/setup-new")
        .set(authHeader)
        .send({
          ticketsSpreadsheetId: "tickets-id",
          itemEntrySpreadsheetId: "items-id",
          bidManagementSpreadsheetId: "bidmgmt-id"
        });

      expect(response.status).toBe(200);
      const results = response.text.trim().split("\n").map(line => JSON.parse(line));
      expect(results).toContainEqual(expect.objectContaining({ success: true }));

      // Exactly one batchUpdate against Bid-Management, deleting exactly
      // the 2 named tabs by sheetId - Auction-Status (103), tickets (104),
      // and a leftover Auction-Items tab (105, no longer written by
      // performSheetSync) must all survive.
      const bidMgmtDeletes = sheetBatchUpdateRequests.filter(r => r.spreadsheetId === "bidmgmt-id");
      expect(bidMgmtDeletes).toHaveLength(1);
      const deletedSheetIds = bidMgmtDeletes[0].requests.map((r: any) => r.deleteSheet.sheetId).sort();
      expect(deletedSheetIds).toEqual([101, 102]);

      // Auction-Status!A2 reset back to true (open), not left cleared/false.
      expect(lastBulkWritePayload).toEqual([[true]]);

      // Special-Winners and Follow-Up cleared on Bid-Management specifically.
      expect(clearedRanges).toContainEqual({ spreadsheetId: "bidmgmt-id", range: "'Special-Winners'!B2:B3" });
      expect(clearedRanges).toContainEqual({ spreadsheetId: "bidmgmt-id", range: "'Follow-Up'!A2:Z" });

      // Item-Entry and Tickets spreadsheets get their own independent clears.
      expect(clearedRanges).toContainEqual({ spreadsheetId: "items-id", range: "Auction-Items!A2:Z" });
      expect(clearedRanges).toContainEqual({ spreadsheetId: "tickets-id", range: "'tickets'!A2:Z" });
      expect(clearedRanges).toContainEqual({ spreadsheetId: "tickets-id", range: "'sponsor tickets'!A2:Z" });
    });

    it("re-seeds the 11 standard items (raffle tickets, open appeal, auction tickets) right after clearing Auction-Items, so they can't disappear like they used to", async () => {
      // These items used to be synthesized only into Bid Management's now-
      // deleted local Items snapshot, never real rows in the master
      // Auction-Items spreadsheet - once that snapshot mechanism was
      // removed, nothing created them anywhere. Re-seeding them here, as
      // part of the same annual reset that clears Auction-Items!A2:Z,
      // means they can't silently vanish again next year the way a
      // manually-added row would.
      server.use(bidManagementSheetsMetadata());

      const response = await request(app)
        .post("/api/auction/setup-new")
        .set(authHeader)
        .send({
          ticketsSpreadsheetId: "tickets-id",
          itemEntrySpreadsheetId: "items-id",
          bidManagementSpreadsheetId: "bidmgmt-id"
        });

      expect(response.status).toBe(200);

      expect(bundleWritePayload).toHaveLength(11);
      const ids = bundleWritePayload.map((row: any[]) => row[0]);
      expect(ids).toEqual(["1401", "1501", "1502", "1503", "1504", "1601", "1602", "1603", "1604", "1605", AUCTION_TICKETS_ITEM_ID]);

      // Every row: real category/name, blank price fields, Active status
      // (Items.tsx's Auction Catalog only shows Active items), and Allow
      // Multiple Winners (column M, index 12) set to true.
      for (const row of bundleWritePayload) {
        expect(row[9]).toBe("Active");
        expect(row[12]).toBe(true);
      }
      const raffleRow = bundleWritePayload.find((row: any[]) => row[0] === "1502");
      expect(raffleRow[1]).toBe("Raffle Tickets");
      expect(raffleRow[2]).toBe("Five Raffle Tickets for a $500 Amazon Gift Card");

      const ticketsRow = bundleWritePayload.find((row: any[]) => row[0] === AUCTION_TICKETS_ITEM_ID);
      expect(ticketsRow[1]).toBe("Auction Tickets");
    });

    it("surfaces a Bid-Management reset failure to the operator via the streamed log, instead of only the server console, and still finishes", async () => {
      server.use(
        bidManagementSheetsMetadata(),
        http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId\\:batchUpdate', () => {
          return HttpResponse.json({ error: { message: "Quota exceeded" } }, { status: 429 });
        })
      );

      const response = await request(app)
        .post("/api/auction/setup-new")
        .set(authHeader)
        .send({
          ticketsSpreadsheetId: "tickets-id",
          itemEntrySpreadsheetId: "items-id",
          bidManagementSpreadsheetId: "bidmgmt-id"
        });

      const results = response.text.trim().split("\n").map(line => JSON.parse(line));

      // The failure must be visible in the operator-facing log, not just
      // swallowed into the server's own console.
      expect(results).toContainEqual(expect.objectContaining({
        log: expect.stringContaining("Failed deleting sheets from Bid Management")
      }));
      // Deliberately resilient: one failed cleanup sub-step doesn't fail
      // the whole setup run (the subsequent Auction-Status reset and
      // Special-Winners/Follow-Up clears still ran).
      expect(results).toContainEqual(expect.objectContaining({ success: true }));
      expect(lastBulkWritePayload).toEqual([[true]]);
    });
  });
});