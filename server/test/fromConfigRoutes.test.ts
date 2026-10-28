/**
 * The routes ROADMAP B12 moved onto fromConfig: each one works on the
 * Config's spreadsheets and folders, whatever a stale browser tab sends.
 */
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { app } from "../app";
import { server } from "./setup";
import { authCookieHeader } from "./helpers/session";
import { getAdminFirestore } from "../services/firebaseAdmin";

const admin = authCookieHeader({ access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 });
const STALE = "last-years-sheet";

const idAfter = (url: string, prefix: string) => new URL(url).pathname.split(prefix)[1].split(/[/:]/)[0];

/** Every Google file/spreadsheet ID a request reached. */
let touched: string[] = [];

beforeEach(async () => {
  touched = [];
  await getAdminFirestore().collection("settings").doc("global").set({
    bidManagementSpreadsheetId: "bm", auctionItemsSpreadsheetId: "it", auctionTicketsSpreadsheetId: "tk",
    forPrintFolderId: "print", bugReportsSpreadsheetId: "bugs",
  });
  server.use(
    http.all("https://sheets.googleapis.com/v4/spreadsheets/*", ({ request }) => {
      touched.push(idAfter(request.url, "/spreadsheets/"));
      return HttpResponse.json({ values: [], sheets: [], replies: [] });
    }),
    http.all("https://www.googleapis.com/drive/v3/files/*", ({ request }) => {
      touched.push(idAfter(request.url, "/files/"));
      return HttpResponse.json({ id: "copy", files: [] });
    }),
  );
});

describe("routes take their spreadsheets from the Config, not the request (ROADMAP B12)", () => {
  it.each([
    ["add an item", "/api/auction/add-item", { spreadsheetId: STALE, category: "A", name: "Mug", idempotencyKey: "k1" }, "it"],
    ["delete an item", "/api/auction/delete-item", { spreadsheetId: STALE, rowIndex: 2, idempotencyKey: "k2" }, "it"],
    ["edit an item", "/api/auction/update-item", { spreadsheetId: STALE, rowIndex: 2, changes: { name: "Mug" }, expectedName: "Cup" }, "it"],
    ["bulk-edit items", "/api/auction/bulk-update-items", { spreadsheetId: STALE, rowIndices: [2], field: "donor", value: "Pat", idempotencyKey: "k3" }, "it"],
    ["bundle items", "/api/bundle/process", { spreadsheetId: STALE, targetIds: ["A01"], newName: "Set", targetCategory: "A", idempotencyKey: "k4" }, "it"],
    ["restore a bundle", "/api/bundle/restore", { spreadsheetId: STALE, targetBundleToken: "b", idempotencyKey: "k5" }, "it"],
    ["make an item document", "/api/production/item-entry/catalog", { spreadsheetId: STALE, folderId: STALE }, "it"],
    ["make bidder labels", "/api/production/tickets/bidder-labels", { bidManagementSpreadsheetId: STALE, auctionTicketsSpreadsheetId: STALE, folderId: STALE }, "bm"],
    ["Set Up Bid Management App", "/api/bidders/sync", { spreadsheetId: STALE, auctionTicketSheetsID: STALE }, "bm"],
    ["save a _Settings value", "/api/settings/update", { spreadsheetId: STALE, key: "ticketPrice", value: "35", idempotencyKey: "k6" }, "bm"],
    ["set up a new auction year", "/api/auction/setup-new", { ticketsSpreadsheetId: STALE, itemEntrySpreadsheetId: STALE, bidManagementSpreadsheetId: STALE }, "bm"],
    ["archive the auction", "/api/auction/archive", { year: 2026, ticketsSpreadsheetId: STALE, itemEntrySpreadsheetId: STALE, bidManagementSpreadsheetId: STALE }, "bm"],
    ["resolve a bug report", "/api/bug-reports/resolve", { spreadsheetId: STALE, reportId: "r1" }, "bugs"],
  ])("%s", async (_label, path, body, expected) => {
    await request(app).post(path).set(admin).send(body);

    expect(touched).not.toContain(STALE);
    expect(touched).toContain(expected);
  });

  it("lists bug reports from the Config's spreadsheet (a GET's query string)", async () => {
    await request(app).get("/api/bug-reports/list").query({ spreadsheetId: STALE }).set(admin);

    expect(touched).toEqual(["bugs"]);
  });

  it("files a bug report in the Config's spreadsheet", async () => {
    await request(app).post("/api/bug-reports").set(admin)
      .send({ title: "t", description: "d", type: "Bug", bugReportsSpreadsheetId: STALE });

    expect(touched).toEqual(["bugs"]);
  });

  it("never uses a spreadsheet from someone not signed in, even while the Config has none", async () => {
    await getAdminFirestore().collection("settings").doc("global").set({});

    const res = await request(app).post("/api/bug-reports").send({ title: "t", description: "d", type: "Bug", bugReportsSpreadsheetId: STALE });

    expect(res.status).toBe(200);
    expect(touched).toEqual([]);
  });

  it("still uses a staff member's own value while the Config field is blank", async () => {
    await getAdminFirestore().collection("settings").doc("global").set({});

    await request(app).post("/api/settings/update").set(admin).send({ spreadsheetId: "typed-in", key: "k", value: "v", idempotencyKey: "k7" });

    expect(touched).toContain("typed-in");
  });
});
