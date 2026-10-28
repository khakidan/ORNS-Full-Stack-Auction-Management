import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { authCookieHeader, sessionCookie } from "./helpers/session";
import { createFakeFirestore } from "./helpers/fakeFirestore";

const fake = createFakeFirestore();
vi.mock("../services/firebaseAdmin", () => ({ getAdminFirestore: () => fake.db }));

import { app } from "../app";
import { logAction } from "../services/actionLog";
import { _resetVolunteerCachesForTesting } from "../services/volunteerService";
import { _resetUserCacheForTesting } from "../services/userService";
import { changesSince } from "../utils/changeFeed";

const tokens = { access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 };
const fullAdmin = authCookieHeader(tokens);
const plainUser = authCookieHeader(tokens, "sam@orns.org");

const STORED = {
  auctionItemsSpreadsheetId: "it", auctionTicketsSpreadsheetId: "tk", bidManagementSpreadsheetId: "bm",
  bidderNumbersSheet: "Bidder-Numbers", bidManagementSheet: "Bid-Management",
  receiptFolderId: "receipts", forPrintFolderId: "print", ornsLogoId: "logo", ticketPrice: "35",
  auctionItemsScriptId: "", auctionTicketsScriptId: "", bidManagementScriptId: "",
  bugReportsSpreadsheetId: "bugs", bugReportsFolderId: "bug-folder", paypalIsSandbox: true,
};

beforeEach(() => {
  fake.clear();
  _resetVolunteerCachesForTesting();
  _resetUserCacheForTesting();
  vi.mocked(logAction).mockClear();
  fake.docs("settings").set("global", { ...STORED, auctionItemsSheet: "stale" });
});

describe("GET /api/config", () => {
  it("gives every signed-in staff member the whole Config, not just admins", async () => {
    const res = await request(app).get("/api/config").set(plainUser);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(STORED);
  });

  it("gives a volunteer only the Bid Management fields", async () => {
    fake.docs("volunteers").set("v1", { email: "pat@gmail.com", name: "Pat", status: "active" });
    fake.docs("system").set("volunteerAuth", { refreshToken: "volunteer-refresh" });
    server.use(http.get("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", () => HttpResponse.json({ values: [["Live"]] })));

    const res = await request(app).get("/api/config").set({ Cookie: sessionCookie({ volunteer: { id: "v1", email: "pat@gmail.com" } }) });

    expect(res.status).toBe(200);
    expect(res.body.bidManagementSpreadsheetId).toBe("bm");
    expect(res.body).not.toHaveProperty("bugReportsSpreadsheetId");
    expect(res.body).not.toHaveProperty("ornsLogoId");
  });

  it("needs a sign-in", async () => {
    expect((await request(app).get("/api/config")).status).toBe(401);
  });
});

describe("POST /api/config", () => {
  it("is refused for a User - Settings is for Administrators", async () => {
    const res = await request(app).post("/api/config").set(plainUser).send({ ...STORED, ticketPrice: "1" });
    expect(res.status).toBe(403);
    expect(fake.docs("settings").get("global")?.ticketPrice).toBe("35");
  });

  it("lets an Administrator save Configuration, but not switch PayPal sandbox/live - that's the PayPal Integration tab, Full Administrators only", async () => {
    fake.docs("users").set("jane@orns.org", { role: "admin" });
    const admin = authCookieHeader(tokens, "jane@orns.org");

    const res = await request(app).post("/api/config").set(admin).send({ ...STORED, ticketPrice: "40", paypalIsSandbox: false });

    expect(res.status).toBe(200);
    expect(fake.docs("settings").get("global")).toMatchObject({ ticketPrice: "40", paypalIsSandbox: true });
  });

  it("lets a Full Administrator switch PayPal to live", async () => {
    const res = await request(app).post("/api/config").set(fullAdmin).send({ ...STORED, paypalIsSandbox: false });
    expect(res.status).toBe(200);
    expect(fake.docs("settings").get("global")?.paypalIsSandbox).toBe(false);
  });

  it("saves the Config, records what changed, and tells open screens to reload it", async () => {
    const before = changesSince(0).version;

    const res = await request(app).post("/api/config").set(fullAdmin).send({ ...STORED, ticketPrice: " 40 ", forPrintFolderId: "print-2027" });

    expect(res.status).toBe(200);
    expect(fake.docs("settings").get("global")).toMatchObject({ ticketPrice: "40", forPrintFolderId: "print-2027", updatedBy: "test-admin@orns.org" });
    expect(fake.docs("settings").get("global")).not.toHaveProperty("auctionItemsSheet");
    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "Save configuration",
      before: { forPrintFolderId: "print", ticketPrice: "35" },
      after: { forPrintFolderId: "print-2027", ticketPrice: "40" },
    }));
    expect(changesSince(before).changed).toContain("config");
    // The next read sees the save straight away, not after the cache expires.
    expect((await request(app).get("/api/config").set(plainUser)).body.ticketPrice).toBe("40");
  });

  it.each([
    ["a value that isn't text", { bidManagementSpreadsheetId: 5 }],
    ["a value that's too long", { ticketPrice: "12345678901" }],
    ["no PayPal mode", { paypalIsSandbox: undefined }],
  ])("refuses %s", async (_label, change) => {
    const res = await request(app).post("/api/config").set(fullAdmin).send({ ...STORED, ...change });
    expect(res.status).toBe(400);
  });
});
