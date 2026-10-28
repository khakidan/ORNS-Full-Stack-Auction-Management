import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { authCookieHeader, TEST_ADMIN_EMAIL } from "./helpers/session";
import { app } from "../app";
import { buildActionRow, parseActionRows, ACTION_HISTORY_HEADER } from "../services/actionHistoryRows";
import { getActionHistorySpreadsheetId, setActionHistorySpreadsheetId } from "../services/actionHistoryStore";
import { logAction } from "../services/actionLog";
import { changesSince } from "../utils/changeFeed";
import { signUndoData } from "../utils/undoData";
import * as userService from "../services/userService";

// Sheet-edit rows (unsigned Undo Data) may only be undone in this year's Items and Tickets spreadsheets.
vi.mock("../services/configService", async (importActual) => ({
  ...(await importActual<typeof import("../services/configService")>()),
  getSharedConfig: vi.fn(async () => ({ auctionItemsSpreadsheetId: "it-sheet", auctionTicketsSpreadsheetId: "tk-sheet" })),
}));
const TRUSTED = { itemsSpreadsheetId: "it-sheet", ticketsSpreadsheetId: "tk-sheet" };

const tokens = { access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 };
const admin = authCookieHeader(tokens);
const LOG_ID = "action-log-sheet";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

describe("Action History rows", () => {
  it("builds one row per action: who, role, source, area, JSON before/after, and the Undo Data that makes it undoable", () => {
    const row = buildActionRow({
      who: "kim@yahoo.com", role: "Volunteer", source: "App", area: "Bid Management", action: "Check in",
      target: "Bidder 104", summary: "Checked in bidder 104", before: false, after: true, location: "Bid Management 'Bidder-Numbers'!E7",
      undo: { kind: "cells", spreadsheetId: "bm", range: "'Bidder-Numbers'!E7", before: [[false]], after: [[true]] },
    }, new Date("2026-03-14T18:02:12Z"));

    expect(row).toHaveLength(ACTION_HISTORY_HEADER.length);
    expect(row[0]).toMatch(/^20260314-180212-[0-9a-f]{6}$/);
    expect(row.slice(1, 12)).toEqual(["2026-03-14T18:02:12.000Z", "kim@yahoo.com", "Volunteer", "App", "Bid Management", "Check in", "Bidder 104", "Checked in bidder 104", "false", "true", "Bid Management 'Bidder-Numbers'!E7"]);
    expect(row[12]).toBe("");
    // Signed with the server's secret and the Action ID, so a hand-typed or edited Undo Data is refused.
    const [, sig, json] = /^v1:([0-9a-f]{64}):(.*)$/s.exec(row[14])!;
    expect(row[14]).toBe(signUndoData(row[0], json));
    expect(sig).toHaveLength(64);
    expect(JSON.parse(json)).toMatchObject({ kind: "cells", range: "'Bidder-Numbers'!E7" });

    const listed = parseActionRows([[...ACTION_HISTORY_HEADER], row], TRUSTED)[0];
    expect(listed.undoable).toBe(true);
    expect(listed.undoPreview).toBe("Writes false to 'Bidder-Numbers'!E7 in spreadsheet bm.");
  });

  it("doesn't offer Undo for Undo Data typed or changed in the spreadsheet, and says why", () => {
    const row = buildActionRow({ who: "a@orns.org", role: "User", source: "App", area: "Users", action: "Change role", summary: "x",
      undo: { kind: "role", email: "sam@orns.org", before: "user", after: "admin" } });
    const edited = [...row];
    edited[14] = row[14].replace('"before":"user"', '"before":"full_admin"');
    const forged = [...row];
    forged[14] = JSON.stringify({ kind: "role", email: "sam@orns.org", before: "full_admin", after: "user" });

    const [e, f] = parseActionRows([[...ACTION_HISTORY_HEADER], edited, forged], TRUSTED);
    expect(e).toMatchObject({ undoable: false, undoPreview: "", undo: "Can't be undone: its Undo Data was changed in the spreadsheet by hand" });
    expect(f).toMatchObject({ undoable: false, undo: "Can't be undone: its Undo Data wasn't written by the app" });
  });

  it("says why an action can't be undone, and leaves its Undo Data empty", () => {
    const row = buildActionRow({ who: "a@orns.org", role: "User", source: "App", area: "Bid Management", action: "Email receipt", summary: "x", notUndoableReason: "emails have gone out" });
    expect(row[12]).toBe("Can't be undone: emails have gone out");
    expect(row[14]).toBe("");
    expect(parseActionRows([[...ACTION_HISTORY_HEADER], row], TRUSTED)[0].undoable).toBe(false);
  });
});

describe("logAction", () => {
  it("appends the row RAW (so typed text is never read as a formula) as the person acting", async () => {
    const real = await vi.importActual<typeof import("../services/actionLog")>("../services/actionLog");
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValueOnce(LOG_ID);
    let appended: any = null;
    server.use(http.post(`${SHEETS}/:id/values/:range\\:append`, async ({ request, params }) => {
      appended = { id: params.id, url: request.url, body: await request.json() };
      return HttpResponse.json({});
    }));

    await real.logAction({ user: { email: "jane@orns.org", role: "admin", capabilities: [] }, session: { tokens } } as any, {
      area: "Auction Items", action: "Edit item", summary: "=HYPERLINK(\"x\")", notUndoableReason: "test",
    });

    expect(appended.id).toBe(LOG_ID);
    expect(appended.url).toContain("valueInputOption=RAW");
    expect(appended.body.values[0].slice(2, 9)).toEqual(["jane@orns.org", "Administrator", "App", "Auction Items", "Edit item", "", "=HYPERLINK(\"x\")"]);
  });

  it("records work the server does on its own (the PayPal sweeper) as that job, with the job's own Google access (ROADMAP B5)", async () => {
    const real = await vi.importActual<typeof import("../services/actionLog")>("../services/actionLog");
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValueOnce(LOG_ID);
    let appended: any = null;
    server.use(http.post(`${SHEETS}/:id/values/:range\\:append`, async ({ request }) => {
      appended = { auth: request.headers.get("authorization"), body: await request.json() };
      return HttpResponse.json({});
    }));
    const { google } = await import("googleapis");
    const { getAuthenticatedClient } = await import("../services/oauth");
    const sheets = google.sheets({ version: "v4", auth: getAuthenticatedClient({ access_token: "sweeper-token" }) });

    await real.logSystemAction(sheets, "PayPal sweeper", { area: "Bid Management", action: "PayPal payment confirmed", summary: "s", notUndoableReason: "x" });

    expect(appended.auth).toBe("Bearer sweeper-token");
    expect(appended.body.values[0].slice(2, 7)).toEqual(["PayPal sweeper", "System", "App", "Bid Management", "PayPal payment confirmed"]);
  });

  it("writes to Cloud Logging instead - never failing the action - when there's no spreadsheet yet or the write fails", async () => {
    const real = await vi.importActual<typeof import("../services/actionLog")>("../services/actionLog");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const req = { user: { email: "a@orns.org", role: "user", capabilities: [] }, session: { tokens } } as any;

    await real.logAction(req, { area: "Tickets", action: "Add attendee", summary: "s1" });
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValueOnce(LOG_ID);
    server.use(http.post(`${SHEETS}/:id/values/:range\\:append`, () => HttpResponse.json({ error: { message: "nope" } }, { status: 500 })));
    await real.logAction(req, { area: "Tickets", action: "Add attendee", summary: "s2" });

    const entries = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(entries.map((e) => e.actionLog[8])).toEqual(["s1", "s2"]);
    expect(entries[0].message).toContain("isn't set up yet");
    expect(entries[1].message).toContain("Couldn't write");
    log.mockRestore();
  });
});

describe("/api/action-history", () => {
  beforeEach(() => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue(LOG_ID);
  });

  it("sends the newest actions a page at a time, without the Undo Data (ROADMAP A15)", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      [`act-${i + 1}`, "t", "a@orns.org", "", "App", "Settings", "Do", "", `s${i + 1}`, "", "", "", "Can't be undone: x", "", ""]);
    server.use(http.get(`${SHEETS}/:id/values/:range`, () => HttpResponse.json({ values: [[...ACTION_HISTORY_HEADER], ...rows] })));

    const first = await request(app).get("/api/action-history?limit=2").set(admin);
    expect(first.body.actions.map((a: any) => a.id)).toEqual(["act-5", "act-4"]);
    expect(first.body).toMatchObject({ total: 5, more: true });
    expect(first.body.actions[0]).not.toHaveProperty("undoData");

    const next = await request(app).get("/api/action-history?limit=2&before=act-4").set(admin);
    expect(next.body.actions.map((a: any) => a.id)).toEqual(["act-3", "act-2"]);
    const last = await request(app).get("/api/action-history?limit=2&before=act-2").set(admin);
    expect(last.body).toMatchObject({ more: false });
    expect(last.body.actions.map((a: any) => a.id)).toEqual(["act-1"]);

    const gone = await request(app).get("/api/action-history?limit=2&before=deleted-row").set(admin);
    expect(gone.body).toMatchObject({ actions: [], restart: true });
  });

  it("is for Administrators, not Users", async () => {
    const user = authCookieHeader(tokens, "sam@orns.org");
    vi.spyOn(await import("../services/userService"), "getRole").mockResolvedValue("user");
    expect((await request(app).get("/api/action-history").set(user)).status).toBe(403);
    expect((await request(app).post("/api/action-history/x/undo").set(user)).status).toBe(403);
    vi.restoreAllMocks();
  });

  it("creates the spreadsheet in the Template Files folder (next to the master spreadsheets) with the header row, and remembers it", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue("");
    const calls: string[] = [];
    let header: unknown = null;
    server.use(
      http.post("https://www.googleapis.com/drive/v3/files", async ({ request }) => {
        const body: any = await request.json();
        calls.push(`create ${body.name} in ${body.parents[0]} as ${body.mimeType}`);
        return HttpResponse.json({ id: "new-log" });
      }),
      http.get(`${SHEETS}/:id`, () => HttpResponse.json({ sheets: [{ properties: { sheetId: 0 } }] })),
      http.post(`${SHEETS}/:id\\:batchUpdate`, async ({ request }) => {
        const body: any = await request.json();
        calls.push(`format ${body.requests.map((r: any) => Object.keys(r)[0]).join(",")}`);
        return HttpResponse.json({});
      }),
      http.put(`${SHEETS}/:id/values/:range`, async ({ request }) => {
        header = ((await request.json()) as any).values[0];
        return HttpResponse.json({});
      })
    );

    const res = await request(app).post("/api/action-history/create").set(admin);

    expect(res.status).toBe(200);
    expect(res.body.spreadsheetId).toBe("new-log");
    expect(calls).toEqual([
      "create Action History in test-template-files-folder-id as application/vnd.google-apps.spreadsheet",
      "format updateSheetProperties,repeatCell,addProtectedRange",
    ]);
    expect(header).toEqual([...ACTION_HISTORY_HEADER]);
    expect(setActionHistorySpreadsheetId).toHaveBeenCalledWith("new-log", TEST_ADMIN_EMAIL);
  });

  it("won't make a second spreadsheet while the current one still opens", async () => {
    server.use(http.get(`${SHEETS}/:id`, () => HttpResponse.json({ spreadsheetId: LOG_ID })));
    const res = await request(app).post("/api/action-history/create").set(admin);
    expect(res.status).toBe(409);
  });

  describe("undo", () => {
    const undoCells = { kind: "cells", spreadsheetId: "bm", range: "'Bidder-Numbers'!E7", before: [[false]], after: [[true]] };
    /** `signed: false` is Undo Data as the Apps Scripts (or someone typing in the sheet) write it. */
    function logRows(undo: string, undoData: unknown, { signed = true, id = "act-1" } = {}) {
      const json = undoData ? JSON.stringify(undoData) : "";
      return [
        [...ACTION_HISTORY_HEADER],
        [id, "t", "kim@yahoo.com", "Volunteer", "App", "Bid Management", "Check in", "Bidder 104", "Checked in bidder 104", "false", "true", "loc", undo, "", json && signed ? signUndoData(id, json) : json],
      ];
    }
    function sheetsWith(rows: unknown[][], currentCell: unknown) {
      const writes: { range: string; values: unknown }[] = [];
      server.use(
        http.get(`${SHEETS}/:id/values/:range`, ({ params }) =>
          HttpResponse.json({ values: params.id === LOG_ID ? rows : [[currentCell]] })),
        http.put(`${SHEETS}/:id/values/:range`, async ({ params, request }) => {
          writes.push({ range: `${params.id} ${decodeURIComponent(String(params.range))}`, values: ((await request.json()) as any).values });
          return HttpResponse.json({});
        })
      );
      return writes;
    }

    it("puts the old value back, marks the action undone, and records the Undo", async () => {
      const writes = sheetsWith(logRows("", undoCells), true);
      const version = changesSince(0).version;

      const res = await request(app).post("/api/action-history/act-1/undo").set(admin);

      expect(res.status).toBe(200);
      // Every open screen showing Bid Management is told to reload it (live refresh).
      expect(changesSince(version).changed).toContain("bm");
      // ...and told why, with who undid what.
      expect(changesSince(version).notices).toEqual([expect.objectContaining({
        by: TEST_ADMIN_EMAIL,
        message: `${TEST_ADMIN_EMAIL} undid an action: Checked in bidder 104 (done by kim@yahoo.com). It's back to how it was before.`,
      })]);
      expect(writes[0]).toEqual({ range: "bm 'Bidder-Numbers'!E7", values: [[false]] });
      expect(writes[1].range).toBe(`${LOG_ID} 'Actions'!M2`);
      expect(String((writes[1].values as any)[0][0])).toMatch(new RegExp(`^Undone by ${TEST_ADMIN_EMAIL} at `));
      expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "Undo: Check in", undoOf: "act-1" }));
    });

    it("refuses, writing nothing, when the value has changed since", async () => {
      const writes = sheetsWith(logRows("", undoCells), false);
      const res = await request(app).post("/api/action-history/act-1/undo").set(admin);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("changed since");
      expect(writes).toEqual([]);
    });

    it.each([
      ["already undone", "Undone by x at y", undoCells, "already undone"],
      ["can't be undone", "Can't be undone: emails have gone out", null, "emails have gone out"],
    ])("refuses an action that is %s", async (_label, undoCol, data, message) => {
      const writes = sheetsWith(logRows(undoCol, data), true);
      const res = await request(app).post("/api/action-history/act-1/undo").set(admin);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain(message);
      expect(writes).toEqual([]);
    });

    it("refuses Undo Data typed into the spreadsheet - e.g. a role \"undo\" that makes someone a Full Administrator", async () => {
      const setRole = vi.spyOn(userService, "setRole").mockResolvedValue();
      const writes = sheetsWith(logRows("", { kind: "role", email: "sam@orns.org", before: "full_admin", after: "user" }, { signed: false }), true);
      const res = await request(app).post("/api/action-history/act-1/undo").set(admin);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("wasn't written by the app");
      expect(setRole).not.toHaveBeenCalled();
      expect(writes).toEqual([]);
      setRole.mockRestore();
    });

    it("refuses signed Undo Data that was edited, or copied onto another Action ID", async () => {
      const rows = logRows("", undoCells);
      const writes = sheetsWith([rows[0], [...rows[1].slice(0, 14), String(rows[1][14]).replace('"before":[[false]]', '"before":[["=IMPORTRANGE()"]]')]], true);
      expect((await request(app).post("/api/action-history/act-1/undo").set(admin)).body.error).toContain("changed in the spreadsheet by hand");

      sheetsWith([rows[0], ["act-2", ...rows[1].slice(1)]], true);
      expect((await request(app).post("/api/action-history/act-2/undo").set(admin)).body.error).toContain("changed in the spreadsheet by hand");
      expect(writes).toEqual([]);
    });

    it("undoes a one-cell Sheet edit of the Items spreadsheet, writing a restored formula-like value as text, under the items lock", async () => {
      const edit = { kind: "cells", spreadsheetId: "it-sheet", range: "'Auction-Items'!C5", before: [["=HYPERLINK(\"x\")"]], after: [["Vase"]] };
      const writes = sheetsWith(logRows("", edit, { signed: false }), "Vase");
      const res = await request(app).post("/api/action-history/act-1/undo").set(admin);
      expect(res.status).toBe(200);
      expect(writes[0]).toEqual({ range: "it-sheet 'Auction-Items'!C5", values: [["'=HYPERLINK(\"x\")"]] });
    });

    it.each([
      ["another spreadsheet", { kind: "cells", spreadsheetId: "bm", range: "'Bidder-Numbers'!E7", before: [[false]], after: [[true]] }],
      ["more than one cell", { kind: "cells", spreadsheetId: "tk-sheet", range: "'tickets'!A1:Z9", before: [[""]], after: [["x"]] }],
      ["a kind other than cells", { kind: "item-add", spreadsheetId: "it-sheet", rowIndex: 5, name: "Vase" }],
    ])("refuses unsigned Undo Data for %s", async (_label, data) => {
      const writes = sheetsWith(logRows("", data, { signed: false }), true);
      const res = await request(app).post("/api/action-history/act-1/undo").set(admin);
      expect(res.status).toBe(409);
      expect(writes).toEqual([]);
    });

    it("won't undo the same action twice, even if its \"Undone by\" cell is cleared by hand", async () => {
      sheetsWith(logRows("", undoCells), true);
      expect((await request(app).post("/api/action-history/act-1/undo").set(admin)).status).toBe(200);

      const writes = sheetsWith(logRows("", undoCells), true);
      const res = await request(app).post("/api/action-history/act-1/undo").set(admin);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("already undone");
      expect(writes).toEqual([]);
    });

    it("refuses an Action ID that appears on more than one row", async () => {
      const rows = logRows("", undoCells);
      const writes = sheetsWith([...rows, rows[1]], true);
      const res = await request(app).post("/api/action-history/act-1/undo").set(admin);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain("More than one row");
      expect(writes).toEqual([]);
    });

    it("marks the action's row as it is after the undo, not where it was found before (a row inserted meanwhile - ROADMAP A8)", async () => {
      const rows = logRows("", undoCells);
      const shifted = [rows[0], ["act-0", "t", "x", "", "App", "Tickets", "Other", "", "s", "", "", "", "Can't be undone: x", "", ""], rows[1]];
      let logReads = 0;
      const writes: string[] = [];
      server.use(
        http.get(`${SHEETS}/:id/values/:range`, ({ params }) =>
          HttpResponse.json({ values: params.id === LOG_ID ? (logReads++ === 0 ? rows : shifted) : [[true]] })),
        http.put(`${SHEETS}/:id/values/:range`, ({ params }) => {
          writes.push(`${params.id} ${decodeURIComponent(String(params.range))}`);
          return HttpResponse.json({});
        })
      );

      expect((await request(app).post("/api/action-history/act-1/undo").set(admin)).status).toBe(200);
      expect(writes).toContain(`${LOG_ID} 'Actions'!M3`);
      expect(writes).not.toContain(`${LOG_ID} 'Actions'!M2`);
    });

    it("answers 404 for an unknown action", async () => {
      sheetsWith(logRows("", undoCells), true);
      expect((await request(app).post("/api/action-history/nope/undo").set(admin)).status).toBe(404);
    });
  });
});

describe("POST /api/action-history/edit-tracking", () => {
  it("installs the on-edit trigger in the Items and Tickets scripts, pointed at the Action History", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue(LOG_ID);
    const runs: any[] = [];
    server.use(http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", async ({ params, request }) => {
      runs.push({ scriptId: params.scriptId, ...((await request.json()) as any) });
      return HttpResponse.json({ response: { result: { success: true } } });
    }));

    const res = await request(app).post("/api/action-history/edit-tracking").set(admin).send({ itemsSpreadsheetId: "it", ticketsSpreadsheetId: "tk" });

    expect(res.body.success).toBe(true);
    expect(runs.map((r) => [r.scriptId, r.function, r.parameters])).toEqual([
      ["test-item-entry-script-id", "apiEnableEditTracking", [LOG_ID, "it"]],
      ["test-tickets-script-id", "apiEnableEditTracking", [LOG_ID, "tk"]],
    ]);
  });

  it("says to sign in again, not Google's raw error, when the sign-in predates the trigger permission", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue(LOG_ID);
    server.use(http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", () =>
      HttpResponse.json({ response: { result: { success: false, error: "You do not have permission to call ScriptApp.getProjectTriggers. Required permissions: https://www.googleapis.com/auth/script.scriptapp" } } })));

    const res = await request(app).post("/api/action-history/edit-tracking").set(admin).send({ itemsSpreadsheetId: "it", ticketsSpreadsheetId: "tk" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Your Google sign-in doesn't include the permission this needs yet. Sign out, sign in again and approve the new permission, then try again.");
  });

  it("turns tracking off in both scripts when enabled is false", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue(LOG_ID);
    const runs: any[] = [];
    server.use(http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", async ({ params, request }) => {
      runs.push({ scriptId: params.scriptId, ...((await request.json()) as any) });
      return HttpResponse.json({ response: { result: { success: true } } });
    }));

    const res = await request(app).post("/api/action-history/edit-tracking").set(admin).send({ enabled: false });

    expect(res.body.success).toBe(true);
    expect(runs.map((r) => [r.scriptId, r.function])).toEqual([
      ["test-item-entry-script-id", "apiDisableEditTracking"],
      ["test-tickets-script-id", "apiDisableEditTracking"],
    ]);
    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "Turn off edit tracking" }));
  });

  it("remembers who turned it on and when, reports it with the status, and forgets it when turned off (ROADMAP A11)", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue(LOG_ID);
    server.use(http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", () => HttpResponse.json({ response: { result: { success: true, on: true } } })));

    await request(app).post("/api/action-history/edit-tracking").set(admin).send({ itemsSpreadsheetId: "it", ticketsSpreadsheetId: "tk" });
    expect((await request(app).get("/api/action-history/edit-tracking").set(admin)).body.turnedOn).toEqual({ by: TEST_ADMIN_EMAIL, at: expect.any(String) });

    await request(app).post("/api/action-history/edit-tracking").set(admin).send({ enabled: false });
    expect((await request(app).get("/api/action-history/edit-tracking").set(admin)).body.turnedOn).toBeNull();
  });

  it("doesn't record a turn-on that failed in either script", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue(LOG_ID);
    server.use(http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", ({ params }) =>
      HttpResponse.json({ response: { result: params.scriptId === "test-tickets-script-id" ? { success: false, error: "boom" } : { success: true } } })));

    await request(app).post("/api/action-history/edit-tracking").set(admin).send({ itemsSpreadsheetId: "it", ticketsSpreadsheetId: "tk" });

    const { getEditTrackingRecord } = await import("../services/actionHistoryStore");
    expect(await getEditTrackingRecord()).toBeNull();
  });

  it("refuses until the Action History spreadsheet exists", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue("");
    const res = await request(app).post("/api/action-history/edit-tracking").set(admin).send({ itemsSpreadsheetId: "it", ticketsSpreadsheetId: "tk" });
    expect(res.status).toBe(409);
  });
});

describe("GET /api/action-history/edit-tracking", () => {
  const statusFrom = (byScript: Record<string, any>) =>
    server.use(http.post("https://script.googleapis.com/v1/scripts/:scriptId\\:run", ({ params }) => HttpResponse.json(byScript[params.scriptId as string])));

  it("is on only when both scripts are recording to the Action History", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue(LOG_ID);
    statusFrom({ "test-item-entry-script-id": { response: { result: { success: true, on: true } } }, "test-tickets-script-id": { response: { result: { success: true, on: true } } } });
    expect((await request(app).get("/api/action-history/edit-tracking").set(admin)).body.on).toBe(true);

    statusFrom({ "test-item-entry-script-id": { response: { result: { success: true, on: true } } }, "test-tickets-script-id": { response: { result: { success: true, on: false } } } });
    expect((await request(app).get("/api/action-history/edit-tracking").set(admin)).body.on).toBe(false);
  });

  it("is unknown (null) when a script can't say, e.g. it hasn't been redeployed", async () => {
    vi.mocked(getActionHistorySpreadsheetId).mockResolvedValue(LOG_ID);
    statusFrom({
      "test-item-entry-script-id": { error: { message: "ScriptError", details: [{ errorMessage: "Script function not found: apiEditTrackingStatus" }] } },
      "test-tickets-script-id": { response: { result: { success: true, on: true } } },
    });
    expect((await request(app).get("/api/action-history/edit-tracking").set(admin)).body.on).toBeNull();
  });
});

describe("routes record what they did", () => {
  it("a check-in records the cell it ticked and how to undo it", async () => {
    server.use(http.get(`${SHEETS}/:id/values/:range`, () => HttpResponse.json({ values: [["ID"], ["101", "A", "B", "e", "FALSE", "FALSE"]] })));

    await request(app).post("/api/bidders/set-flag").set(admin).send({ spreadsheetId: "bm", bidderNumbersSheet: "Bidder-Numbers", bidderId: "101", flag: "checkedIn" });

    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "Check in",
      target: "Bidder 101",
      undo: { kind: "cells", spreadsheetId: "bm", range: "'Bidder-Numbers'!E2", before: [[false]], after: [[true]], lock: "bidder-numbers:bm" },
    }));
  });

  it("an attendee edit records the cells' old and new values, in the Config's Tickets spreadsheet (not the one the browser named)", async () => {
    server.use(http.get(`${SHEETS}/:id/values/:range`, () => HttpResponse.json({ values: [["old@x.org"]] })));

    const res = await request(app).post("/api/attendees/update").set(admin).send({ spreadsheetId: "tk", range: "tickets!C4", values: [["new@x.org"]] });

    expect(res.status).toBe(200);
    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      area: "Tickets",
      action: "Edit attendee",
      undo: { kind: "cells", spreadsheetId: "tk-sheet", range: "'tickets'!C4", before: [["old@x.org"]], after: [["new@x.org"]] },
    }));
  });

  it("an attendee add resent with the same key (a retry after a dropped connection) adds the row once (ROADMAP A4)", async () => {
    let appends = 0;
    server.use(http.post(`${SHEETS}/:id/values/:range\\:append`, () => {
      appends++;
      return HttpResponse.json({ updates: { updatedRange: "'tickets'!A9:V9" } });
    }));
    const body = { spreadsheetId: "tk", sheet: "tickets", row: ["Pat", "Lee"], idempotencyKey: "add-pat-1" };

    const first = await request(app).post("/api/attendees/add").set(admin).send(body);
    const resent = await request(app).post("/api/attendees/add").set(admin).send(body);

    expect([first.status, resent.status]).toEqual([200, 200]);
    expect(resent.body.duplicated).toBe(true);
    expect(appends).toBe(1);
    expect(vi.mocked(logAction).mock.calls.filter(([, e]) => e.action === "Add attendee")).toHaveLength(1);
  });

  it.each([
    ["a range on another tab", "Bid-Management!C4"],
    ["cells across two rows", "tickets!C4:C5"],
    ["the header row", "tickets!C1"],
  ])("refuses an attendee edit of %s", async (_label, range) => {
    const res = await request(app).post("/api/attendees/update").set(admin).send({ spreadsheetId: "tk", range, values: [["x"]] });
    expect(res.status).toBe(400);
  });
});
