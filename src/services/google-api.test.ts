/**
 * @vitest-environment jsdom
 *
 * fetchWithRetry used to read OAuth tokens out of localStorage and send
 * them on every request in an `x-google-tokens` header - a workaround for
 * running inside AI Studio's iframe, where the session cookie was blocked
 * as third-party. The app is now always a top-level page and the
 * orns_session cookie is the only credential, so these tests guard that
 * no token header is ever sent and that the caller's options pass through
 * untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "./google-api";
import { appendAttendeeRow, fetchWithRetry, ServerUnreachableError } from "./google-api";
import { getRetryStatus, _resetRetryStatusForTesting } from "@/lib/syncStatus";

describe("fetchWithRetry - sends the caller's request as-is", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, clone: () => ({ text: async () => "" }) }));
    // A stale token copy left behind by the old iframe login must not be picked up.
    localStorage.setItem("google_tokens", "stale-token-string");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("never adds an x-google-tokens header, even with a stale token in localStorage", async () => {
    const options = { method: "POST", headers: { "Content-Type": "application/json" } };

    await fetchWithRetry("/api/whatever", options);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("passes the caller's options object through unmodified", async () => {
    const options: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include" };

    await fetchWithRetry("/api/whatever", options);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0][1]).toBe(options);
    expect(options.headers).toEqual({ "Content-Type": "application/json" });
  });
});

/**
 * Milestone A: retries are reported to the sync banner, and a request that
 * never got an answer throws ServerUnreachableError - distinct from a 4xx,
 * which comes back as a Response.
 */
describe("fetchWithRetry - retry reporting", () => {
  const response = (status: number) => ({ ok: status < 400, status, clone: () => ({ text: async () => "" }) });

  beforeEach(() => {
    vi.useFakeTimers();
    _resetRetryStatusForTesting();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports the retry while it waits, then the recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200)));

    const pending = fetchWithRetry("/api/x");
    await vi.waitFor(() => expect(getRetryStatus()).toMatchObject({ retrying: 1, attempt: 2, maxAttempts: 4 }));
    await vi.runAllTimersAsync();
    const res = await pending;

    expect(res.status).toBe(200);
    expect(getRetryStatus()).toMatchObject({ retrying: 0, recoveredAt: expect.any(Number) });
  });

  it("throws ServerUnreachableError after the last attempt, keeping the original message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const pending = fetchWithRetry("/api/x", {}, 2);
    const assertion = expect(pending).rejects.toSatisfy((e: any) => e instanceof ServerUnreachableError && e.message === "Failed to fetch");
    await vi.runAllTimersAsync();
    await assertion;
    expect(getRetryStatus()).toMatchObject({ retrying: 0, recoveredAt: null });
  });

  it("returns a 4xx as a Response, without retrying or reporting anything", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(409)));

    const res = await fetchWithRetry("/api/x");

    expect(res.status).toBe(409);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getRetryStatus().retrying).toBe(0);
  });
});

describe("appendAttendeeRow - a resent add can't add the person twice (ROADMAP A4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends one idempotency key per add, the same on every retry of that add", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, clone: () => ({ text: async () => "" }), json: async () => ({}) })
      .mockResolvedValue({ ok: true, status: 200, clone: () => ({ text: async () => "" }), json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const first = appendAttendeeRow("1abcdefghijklmnopqrstuvwxyz", "tickets", ["Pat", "Lee"]);
    await vi.runAllTimersAsync();
    await first;
    await appendAttendeeRow("1abcdefghijklmnopqrstuvwxyz", "tickets", ["Sam", "Ng"]);
    vi.useRealTimers();

    const keys = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).idempotencyKey);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

/**
 * What each request function sends (ROADMAP T5): method, path, credentials
 * and body, matching the field names the server route reads - so a field
 * renamed on one side fails here. A recording fetch stands in for the
 * network; MSW can't see these relative URLs under jsdom.
 */
describe("the requests each function sends", () => {
  const SHEET = "1abcdefghijklmnopqrstuvwxyz";
  let sent: { url: string; method: string; credentials?: RequestCredentials; body?: any }[];

  function answer(status: number, body: unknown) {
    sent = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url: String(url), method: init.method ?? "GET", credentials: init.credentials, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  const anyKey = expect.stringMatching(/^[0-9a-f-]{36}$/);

  it.each([
    ["getAuthUrl", () => api.getAuthUrl(), "GET", "/auth/url", undefined],
    ["getAuthStatus", () => api.getAuthStatus(), "GET", "/auth/status", undefined],
    ["logout", () => api.logout(), "POST", "/auth/logout", undefined],
    ["getSheetData", () => api.getSheetData(SHEET, "'Bidder-Numbers'!A:L"), "GET", `/api/sheets/${SHEET}/'Bidder-Numbers'!A%3AL`, undefined],
    ["deleteAuctionItem", () => api.deleteAuctionItem(SHEET, 7), "POST", "/api/auction/delete-item", { spreadsheetId: SHEET, rowIndex: 7, idempotencyKey: anyKey }],
    ["getPaypalSweeperStatus", () => api.getPaypalSweeperStatus(), "GET", "/api/paypal-sweeper/status", undefined],
    ["runPaypalSweepNow", () => api.runPaypalSweepNow(), "POST", "/api/paypal-sweeper/run-now", undefined],
    ["getTicketPurchaseStatus", () => api.getTicketPurchaseStatus(), "GET", "/api/tickets/fluent-forms/status", undefined],
    ["checkWebsiteTicketsNow", () => api.checkWebsiteTicketsNow(), "POST", "/api/tickets/fluent-forms/check-now", undefined],
    ["markLateWebsitePurchaseHandled", () => api.markLateWebsitePurchaseHandled("entry 4/5"), "POST", "/api/tickets/fluent-forms/after-go-live/entry%204%2F5/handled", undefined],
    ["getAppsScriptVersions", () => api.getAppsScriptVersions(), "GET", "/api/apps-script/versions", undefined],
    ["getArchivedAuctions", () => api.getArchivedAuctions(), "GET", "/api/archive/auctions", undefined],
    ["updateAttendeeCells", () => api.updateAttendeeCells(SHEET, "tickets!C4", [["new@x.org"]]), "POST", "/api/attendees/update", { spreadsheetId: SHEET, range: "tickets!C4", values: [["new@x.org"]] }],
    ["appendAttendeeRow", () => api.appendAttendeeRow(SHEET, "tickets", ["Pat", "Lee"]), "POST", "/api/attendees/add", { spreadsheetId: SHEET, sheet: "tickets", row: ["Pat", "Lee"], idempotencyKey: anyKey }],
    ["postOnce", () => api.postOnce("/api/production/catalog", { folderId: "f" }), "POST", "/api/production/catalog", { folderId: "f" }],
  ])("%s: %s %s", async (_name, call, method, url, body) => {
    answer(200, { scripts: [], auctions: [] });

    await call();

    expect(sent).toEqual([{ url, method, credentials: "include", body }]);
  });

  it("getSheetData reads nothing for a spreadsheet nobody has set yet", async () => {
    answer(200, {});
    for (const id of ["", "undefined", "PASTE_BID_MANAGEMENT_ID"]) {
      expect(await api.getSheetData(id, "A:A")).toEqual({ values: [] });
    }
    expect(sent).toEqual([]);
  });

  it("getSheetData treats a missing tab as empty, and any other refusal as an error with the server's reason", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    answer(400, { error: "Unable to parse range: Old-Tab!A:A", isRangeError: true });
    expect(await api.getSheetData(SHEET, "Old-Tab!A:A")).toEqual({ values: [] });

    answer(403, { error: "This range isn't available to volunteers." });
    await expect(api.getSheetData(SHEET, "tickets!A:Z")).rejects.toThrow("This range isn't available to volunteers.");
    vi.mocked(console.warn).mockRestore();
  });

  it.each([
    ["deleteAuctionItem", () => api.deleteAuctionItem(SHEET, 7), "Failed to delete auction item"],
    ["getPaypalSweeperStatus", () => api.getPaypalSweeperStatus(), "Failed to fetch PayPal sweeper status"],
    ["runPaypalSweepNow", () => api.runPaypalSweepNow(), "Failed to run PayPal sweep"],
    ["getTicketPurchaseStatus", () => api.getTicketPurchaseStatus(), "Failed to fetch the website ticket status"],
    ["checkWebsiteTicketsNow", () => api.checkWebsiteTicketsNow(), "Failed to check the website's ticket purchases"],
    ["markLateWebsitePurchaseHandled", () => api.markLateWebsitePurchaseHandled("9"), "Failed to mark the purchase as registered"],
    ["updateAttendeeCells", () => api.updateAttendeeCells(SHEET, "tickets!C4", [["x"]]), "Failed to update the attendee"],
    ["appendAttendeeRow", () => api.appendAttendeeRow(SHEET, "tickets", ["x"]), "Failed to add the attendee"],
  ])("%s surfaces the server's reason when refused, else its own", async (_name, call, fallback) => {
    answer(400, { error: "Missing required parameters for deletion" });
    await expect(call()).rejects.toThrow("Missing required parameters for deletion");

    answer(404, {});
    await expect(call()).rejects.toThrow(fallback);
  });

  it.each([
    ["getAppsScriptVersions", () => api.getAppsScriptVersions(), "Failed to check the Apps Script versions"],
    ["getArchivedAuctions", () => api.getArchivedAuctions(), "Couldn't look up the archived auctions."],
  ])("%s prefers the error handler's message, then error, then its own", async (_name, call, fallback) => {
    answer(403, { error: "Forbidden", message: "Only Full Administrators can see this." });
    await expect(call()).rejects.toThrow("Only Full Administrators can see this.");
    answer(403, { error: "Forbidden" });
    await expect(call()).rejects.toThrow("Forbidden");
    answer(404, {});
    await expect(call()).rejects.toThrow(fallback);
  });

  it("refuses to send a write for a spreadsheet nobody has set", async () => {
    answer(200, {});
    await expect(api.deleteAuctionItem("", 7)).rejects.toThrow("Invalid Spreadsheet ID");
    await expect(api.updateAttendeeCells("undefined", "tickets!C4", [["x"]])).rejects.toThrow("Invalid Spreadsheet ID");
    await expect(api.appendAttendeeRow("PASTE_TICKETS_ID", "tickets", ["x"])).rejects.toThrow("Invalid Spreadsheet ID");
    expect(sent).toEqual([]);
  });

  it("postOnce sends once even when the server fails, and throws ServerUnreachableError only with no answer", async () => {
    answer(500, { error: "Script timed out" });
    expect((await api.postOnce("/api/production/catalog", {})).status).toBe(500);
    expect(sent).toHaveLength(1);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(api.postOnce("/api/production/catalog", {})).rejects.toBeInstanceOf(ServerUnreachableError);
  });

  it("errorTextFrom prefers the real reason (message), then error, then the fallback", () => {
    expect(api.errorTextFrom({ error: "Internal Server Error", message: "Quota exceeded" }, "x")).toBe("Quota exceeded");
    expect(api.errorTextFrom({ error: "Bidder 9 not found" }, "x")).toBe("Bidder 9 not found");
    expect(api.errorTextFrom(undefined, "Couldn't print")).toBe("Couldn't print");
  });
});
