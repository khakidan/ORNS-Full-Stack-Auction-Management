/**
 * GET /api/apps-script/versions - asks each live script for its
 * Version.gs fingerprint and compares it with the one this build expects.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { app } from "../app";
import { server } from "./setup";
import { authCookieHeader } from "./helpers/session";
import { EXPECTED_APPS_SCRIPT_VERSIONS } from "../generated/appsScriptVersions";

const authHeader = authCookieHeader({ access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 });

const IDS = { bm: "bm-script-id", items: "items-script-id", tickets: "tickets-script-id" };

/** Answers apiGetVersion per script ID with whatever `answers` says. */
function scriptsAnswer(answers: Record<string, object>) {
  server.use(
    http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", ({ params }) =>
      HttpResponse.json(answers[String(params.scriptId)])
    )
  );
}

const reports = (version: string) => ({ response: { result: { success: true, version } } });

describe("GET /api/apps-script/versions", () => {
  beforeEach(() => {
    process.env.SCRIPT_ID_BID_MANAGEMENT = IDS.bm;
    process.env.SCRIPT_ID_ITEM_ENTRY = IDS.items;
    process.env.SCRIPT_ID_TICKETS = IDS.tickets;
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it("reports each script up to date, out of date, or not checkable", async () => {
    scriptsAnswer({
      [IDS.bm]: reports(EXPECTED_APPS_SCRIPT_VERSIONS.BidManagementSpreadsheet),
      [IDS.items]: reports("000000000000"),
      [IDS.tickets]: { error: { code: 3, message: "ScriptError", details: [{ errorMessage: "Script function not found: apiGetVersion" }] } },
    });

    const response = await request(app).get("/api/apps-script/versions").set(authHeader);

    expect(response.status).toBe(200);
    expect(response.body.scripts).toEqual([
      { label: "Bid Management", expected: EXPECTED_APPS_SCRIPT_VERSIONS.BidManagementSpreadsheet, live: EXPECTED_APPS_SCRIPT_VERSIONS.BidManagementSpreadsheet, status: "ok" },
      { label: "Item Entry", expected: EXPECTED_APPS_SCRIPT_VERSIONS.ItemsSpreadsheet, live: "000000000000", status: "outdated" },
      {
        label: "Tickets", expected: EXPECTED_APPS_SCRIPT_VERSIONS.TicketsSpreadsheet, live: null, status: "error",
        error: "This script has no version check yet - it was deployed before Version.gs existed.",
      },
    ]);
  });

  it("says which Script ID setting is missing", async () => {
    delete process.env.SCRIPT_ID_TICKETS;
    scriptsAnswer({
      [IDS.bm]: reports(EXPECTED_APPS_SCRIPT_VERSIONS.BidManagementSpreadsheet),
      [IDS.items]: reports(EXPECTED_APPS_SCRIPT_VERSIONS.ItemsSpreadsheet),
    });

    const response = await request(app).get("/api/apps-script/versions").set(authHeader);

    expect(response.body.scripts[2]).toMatchObject({ label: "Tickets", status: "error", error: "SCRIPT_ID_TICKETS isn't set on the server." });
    process.env.SCRIPT_ID_TICKETS = IDS.tickets;
  });

  it("passes on any other error, such as a permission refusal", async () => {
    server.use(
      http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", () =>
        HttpResponse.json({ error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } }, { status: 403 })
      )
    );

    const response = await request(app).get("/api/apps-script/versions").set(authHeader);

    expect(response.status).toBe(200);
    for (const s of response.body.scripts) {
      expect(s.status).toBe("error");
      expect(s.error).toContain("The caller does not have permission");
    }
  });

  it("requires sign-in", async () => {
    const response = await request(app).get("/api/apps-script/versions");
    expect(response.status).toBe(401);
  });
});
