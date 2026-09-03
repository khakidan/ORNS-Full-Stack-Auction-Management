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
import { resetHandlersState, clearedRanges, sheetBatchUpdateRequests, lastBulkWritePayload } from "./handlers";

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
    // Bidder-Numbers/Bid-Management/Auction-Status/tickets - no
    // Auction-Items - so every test in this block overrides it with all
    // three deletable tabs plus two tabs that must NOT be deleted
    // (Auction-Status, tickets), to pin the "only the right tabs" behavior.
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

    it("deletes exactly the Auction-Items/Bid-Management/Bidder-Numbers tabs, resets Auction-Status, and clears Special-Winners/Follow-Up - nothing else", async () => {
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
      // the 3 named tabs by sheetId - Auction-Status (103) and tickets
      // (104) must survive.
      const bidMgmtDeletes = sheetBatchUpdateRequests.filter(r => r.spreadsheetId === "bidmgmt-id");
      expect(bidMgmtDeletes).toHaveLength(1);
      const deletedSheetIds = bidMgmtDeletes[0].requests.map((r: any) => r.deleteSheet.sheetId).sort();
      expect(deletedSheetIds).toEqual([101, 102, 105]);

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