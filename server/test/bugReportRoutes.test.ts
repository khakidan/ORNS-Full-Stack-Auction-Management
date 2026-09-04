/**
 * Integration coverage for POST /api/bug-reports through the real app +
 * MSW-mocked Google APIs, complementing the direct unit tests in
 * bugReportService.test.ts. This route is deliberately NOT gated by
 * requireAuth (see bugReportRoutes.ts's own comment) - a report about a
 * broken/expired session must still save - so the "no session" case
 * below is a real, in-scope path, not just an auth-guard smoke test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import { app } from "../app";
import { resetHandlersState, appendCallCount, lastAppendedRow } from "./handlers";

const mockTokens = {
  access_token: "bug-report-mock-token",
  refresh_token: "bug-report-mock-refresh",
  expiry_date: Date.now() + 3600000,
};
const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

const BUG_REPORTS_DIR = path.join(process.cwd(), "bug-reports");

const validBody = {
  title: "Checkout button does nothing",
  description: "Clicked twice, no response.",
  type: "Bug",
  timestamp: "2026-09-03T14:32:07.142Z",
  route: "/BidManagement (workflow: bids, tab: checkout)",
  appState: "Bidders: 42",
  browserInfo: "User-Agent: test-agent",
  consoleActivity: [{ level: "error", message: "boom", timestamp: "2026-09-03T14:32:00.000Z" }],
  screenshotBase64: null,
};

async function listBugReportFiles(): Promise<string[]> {
  try {
    return await fs.readdir(BUG_REPORTS_DIR);
  } catch {
    return [];
  }
}

describe("POST /api/bug-reports", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  afterEach(async () => {
    const files = await listBugReportFiles();
    await Promise.all(files.map((f) => fs.rm(path.join(BUG_REPORTS_DIR, f), { force: true })));
  });

  it("400s when title, description, or type is missing", async () => {
    const res = await request(app).post("/api/bug-reports").send({ title: "Only a title" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("required");
  });

  it("saves to the configured Bug-Reports spreadsheet when authenticated and a spreadsheet ID is provided", async () => {
    const res = await request(app)
      .post("/api/bug-reports")
      .set(authHeader)
      .send({ ...validBody, bugReportsSpreadsheetId: "sheet-abc" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, storage: "sheet" });
    expect(appendCallCount).toBe(1);
    expect(lastAppendedRow).toEqual([
      expect.any(String), // Report ID
      "2026-09-03T14:32:07.142Z",
      "Open",
      "Bug",
      "Checkout button does nothing",
      "Clicked twice, no response.",
      "/BidManagement (workflow: bids, tab: checkout)",
      "Bidders: 42",
      "User-Agent: test-agent",
      expect.stringContaining("boom"),
      "", // no screenshot folder configured -> no link
    ]);

    // The resilient local fallback must not have been used on the happy path.
    expect(await listBugReportFiles()).toHaveLength(0);
  });

  it("falls back to a local .md file when no Bug Reports spreadsheet is configured", async () => {
    const res = await request(app)
      .post("/api/bug-reports")
      .set(authHeader)
      .send(validBody); // no bugReportsSpreadsheetId

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, storage: "local" });
    expect(appendCallCount).toBe(0);

    const files = await listBugReportFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.md$/);
    const content = await fs.readFile(path.join(BUG_REPORTS_DIR, files[0]), "utf-8");
    expect(content).toContain("Checkout button does nothing");
  });

  it("falls back to a local .md file when there is no authenticated session at all (e.g. an expired OAuth session)", async () => {
    const res = await request(app)
      .post("/api/bug-reports")
      // no x-google-tokens header at all
      .send({ ...validBody, bugReportsSpreadsheetId: "sheet-abc" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, storage: "local" });
    expect(appendCallCount).toBe(0);
    expect(await listBugReportFiles()).toHaveLength(1);
  });
});
