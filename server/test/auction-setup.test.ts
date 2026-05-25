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
import { resetHandlersState } from "./handlers";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

describe("setupRoutes - /api/auction/setup-new", () => {
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
});