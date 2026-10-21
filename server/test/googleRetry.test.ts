/**
 * ROADMAP.md M5: the global Google API retry policy must not retry POSTs
 * (a retried values.append after a 5xx Google had already applied adds a
 * duplicate row), while IDEMPOTENT_POST_RETRY opts the safe ones back in.
 */
import { describe, it, expect } from "vitest";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import "../services/google";
import { IDEMPOTENT_POST_RETRY } from "../utils/googleRetry";

function sheetsClient() {
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: "retry-test-token", expiry_date: Date.now() + 3600000 });
  return google.sheets({ version: "v4", auth });
}

describe("Google API retry policy", () => {
  it("does not retry a values.append (POST) that failed with a 5xx", async () => {
    let calls = 0;
    server.use(
      http.post("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", () => {
        calls++;
        return HttpResponse.json({ error: { code: 503, message: "backend error" } }, { status: 503 });
      })
    );

    await expect(
      sheetsClient().spreadsheets.values.append({ spreadsheetId: "s", range: "A:A", valueInputOption: "RAW", requestBody: { values: [["walk-in"]] } })
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("still retries a GET", async () => {
    let calls = 0;
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", () => {
        calls++;
        return calls === 1
          ? HttpResponse.json({ error: { code: 503, message: "backend error" } }, { status: 503 })
          : HttpResponse.json({ values: [["ok"]] });
      })
    );

    const res = await sheetsClient().spreadsheets.values.get({ spreadsheetId: "s", range: "A:A" });
    expect(res.data.values).toEqual([["ok"]]);
    expect(calls).toBe(2);
  });

  it("retries a values.batchUpdate POST when called with IDEMPOTENT_POST_RETRY", async () => {
    let calls = 0;
    server.use(
      http.post("https://sheets.googleapis.com/v4/spreadsheets/:id/values:batchUpdate", () => {
        calls++;
        return calls === 1
          ? HttpResponse.json({ error: { code: 503, message: "backend error" } }, { status: 503 })
          : HttpResponse.json({ totalUpdatedCells: 1 });
      })
    );

    await sheetsClient().spreadsheets.values.batchUpdate(
      { spreadsheetId: "s", requestBody: { valueInputOption: "RAW", data: [{ range: "A1", values: [["x"]] }] } },
      IDEMPOTENT_POST_RETRY
    );
    expect(calls).toBe(2);
  });
});
