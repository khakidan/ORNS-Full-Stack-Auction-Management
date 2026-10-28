import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { authCookieHeader, sessionCookie, TEST_ADMIN_EMAIL } from "./helpers/session";
import { createFakeFirestore } from "./helpers/fakeFirestore";

const fake = createFakeFirestore();
vi.mock("../services/firebaseAdmin", () => ({ getAdminFirestore: () => fake.db }));

import { app } from "../app";
import * as volunteerService from "../services/volunteerService";
import { hashToken, _resetVolunteerCachesForTesting } from "../services/volunteerService";
import { _resetVolunteerLinkRateLimitForTesting } from "../routes/volunteerAuthRoutes";
import { _resetUserCacheForTesting } from "../services/userService";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const tokens = { access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 };
const admin = authCookieHeader(tokens);
const volunteerSession = (id = "v1", email = "pat@gmail.com") => ({ Cookie: sessionCookie({ volunteer: { id, email } }) });

let auctionCell = "Live";
let sheetReads: string[] = [];

beforeEach(() => {
  fake.clear();
  _resetVolunteerCachesForTesting();
  _resetVolunteerLinkRateLimitForTesting();
  _resetUserCacheForTesting();
  auctionCell = "Live";
  sheetReads = [];
  fake.docs("settings").set("global", {
    bidManagementSpreadsheetId: "bm", auctionItemsSpreadsheetId: "it", auctionTicketsSpreadsheetId: "tk",
    receiptFolderId: "receipts", forPrintFolderId: "print",
  });
  fake.docs("system").set("volunteerAuth", { refreshToken: "volunteer-refresh", email: "auction-volunteers@orns.org" });
  server.use(http.get(`${SHEETS}/:id/values/:range`, ({ params, request }) => {
    sheetReads.push(`${params.id} ${decodeURIComponent(String(params.range))} as ${request.headers.get("authorization")}`);
    if (String(params.range).includes("Auction-Status")) return HttpResponse.json({ values: [[auctionCell]] });
    return HttpResponse.json({ values: [["ID"]] });
  }));
});

function addVolunteer(id: string, fields: Record<string, unknown>) {
  fake.docs("volunteers").set(id, { email: "pat@gmail.com", name: "Pat Lee", invitedBy: TEST_ADMIN_EMAIL, invitedAt: "2026-03-01T00:00:00Z", ...fields });
}

describe("inviting volunteers (Users tab)", () => {
  it("stores only a hash of the link token and emails the link from the inviting admin's Gmail", async () => {
    let sent = "";
    server.use(http.post("https://gmail.googleapis.com/gmail/v1/users/:userId/messages/send", async ({ request }) => {
      sent = Buffer.from(((await request.json()) as any).raw, "base64url").toString("utf8");
      return HttpResponse.json({ id: "m" });
    }));

    const res = await request(app).post("/api/volunteers").set(admin).send({ name: "Pat Lee", email: "Pat@Gmail.com" });

    expect(res.status).toBe(200);
    const [[, stored]] = [...fake.docs("volunteers").entries()];
    expect(stored).toMatchObject({ email: "pat@gmail.com", name: "Pat Lee", status: "invited", invitedBy: TEST_ADMIN_EMAIL });
    const token = /token=([A-Za-z0-9_-]+)/.exec(sent)![1];
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(sent).toContain("To: pat@gmail.com");
    expect(res.body.volunteer.tokenHash).toBeUndefined();
  });

  it("refuses @orns.org addresses (staff get a role instead) and non-Full-Admins", async () => {
    expect((await request(app).post("/api/volunteers").set(admin).send({ name: "Sam", email: "sam@orns.org" })).status).toBe(400);
    expect((await request(app).post("/api/volunteers").set(authCookieHeader(tokens, "sam@orns.org")).send({ name: "Pat", email: "pat@gmail.com" })).status).toBe(403);
  });

  it("revoke ends access and forgets the link", async () => {
    addVolunteer("v1", { status: "invited", tokenHash: hashToken("tok") });
    await request(app).post("/api/volunteers/v1/revoke").set(admin);
    expect(fake.docs("volunteers").get("v1")).toMatchObject({ status: "revoked", tokenHash: "" });
  });
});

describe("the one-time link", () => {
  beforeEach(() => addVolunteer("v1", { status: "invited", tokenHash: hashToken("good-token") }));

  it("opening it shows a Sign in button but does not use it up (so email scanners can't burn it)", async () => {
    const res = await request(app).get("/auth/volunteer?token=good-token");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Sign in as Pat Lee");
    expect(fake.docs("volunteers").get("v1")!.status).toBe("invited");
  });

  it("says the auction isn't live yet, and keeps the link valid, before Go Live", async () => {
    auctionCell = "Prep";
    for (const res of [await request(app).get("/auth/volunteer?token=good-token"), await request(app).post("/auth/volunteer").type("form").send({ token: "good-token" })]) {
      expect(res.text).toContain("live yet");
    }
    expect(fake.docs("volunteers").get("v1")!.status).toBe("invited");
  });

  it("signing in uses the link once, starts a volunteer session and goes to Bid Management", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/auth/volunteer").type("form").send({ token: "good-token" });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/BidManagement");
    expect(fake.docs("volunteers").get("v1")).toMatchObject({ status: "active", tokenHash: "", redeemedAt: expect.any(String) });
    expect((await agent.get("/auth/status")).body).toEqual({
      authenticated: true,
      user: { email: "pat@gmail.com", role: "volunteer", roleLabel: "Volunteer", capabilities: [] },
    });

    const again = await request(app).post("/auth/volunteer").type("form").send({ token: "good-token" });
    expect(again.status).toBe(410);
  });

  it("two quick submissions of the same link use it up only once", async () => {
    // Both have already passed the lookup; only one may redeem.
    const results = await Promise.all([volunteerService.redeemVolunteer("v1", "good-token"), volunteerService.redeemVolunteer("v1", "good-token")]);
    expect(results.sort()).toEqual([false, true]);
  });

  it.each([
    ["a Revoke", { status: "revoked", tokenHash: "" }],
    ["a Resend (new link)", { status: "invited", tokenHash: hashToken("newer-token") }],
  ])("isn't undone by %s landing between the link check and the sign-in", async (_label, change) => {
    // The lookup still sees the old record; the change lands before it is used up.
    const find = vi.spyOn(volunteerService, "findVolunteerByToken").mockImplementationOnce(async () => {
      const found = { id: "v1", email: "pat@gmail.com", name: "Pat Lee", status: "invited" as const, invitedBy: "", invitedAt: "" };
      fake.docs("volunteers").set("v1", { ...fake.docs("volunteers").get("v1"), ...change });
      return found;
    });

    const res = await request(app).post("/auth/volunteer").type("form").send({ token: "good-token" });

    expect(res.status).toBe(410);
    expect(fake.docs("volunteers").get("v1")).toMatchObject(change);
    find.mockRestore();
  });

  it("refuses an unknown token", async () => {
    expect((await request(app).get("/auth/volunteer?token=nope")).status).toBe(410);
  });
});

describe("what a signed-in volunteer can do", () => {
  beforeEach(() => addVolunteer("v1", { status: "active" }));

  it("reads the auction's spreadsheets through the shared volunteer account", async () => {
    const res = await request(app).get(`/api/sheets/bm/${encodeURIComponent("Bidder-Numbers!A:L")}`).set(volunteerSession());

    expect(res.status).toBe(200);
    // mock-access-token is what the stored volunteer sign-in refreshes to (handlers.ts).
    expect(sheetReads).toContain("bm 'Bidder-Numbers'!A:L as Bearer mock-access-token");
  });

  it.each([
    ["the Tickets spreadsheet (attendee contact and payment details)", "tk", "'tickets'!A:Z"],
    ["a Bid Management tab their screens don't use", "bm", "_Settings!A:C"],
    ["a range with no tab name", "bm", "A1:Z9"],
  ])("can't read %s (ROADMAP B4)", async (_label, id, range) => {
    const res = await request(app).get(`/api/sheets/${id}/${encodeURIComponent(range)}`).set(volunteerSession());
    expect(res.status).toBe(403);
  });

  it.each([["bm", "Bid-Management!A:ZZ"], ["bm", "'Auction-Status'!A2"], ["it", "Auction-Items!A:Z"]])("can read %s %s, which Bid Management shows", async (id, range) => {
    const res = await request(app).get(`/api/sheets/${id}/${encodeURIComponent(range)}`).set(volunteerSession());
    expect(res.status).toBe(200);
  });

  it("gets the ticket list with only the badge fields - no email, phone or payment details (ROADMAP B4)", async () => {
    server.use(http.get(`${SHEETS}/:id/values/:range`, ({ params }) => {
      const range = decodeURIComponent(String(params.range));
      if (params.id === "tk" && range.startsWith("'tickets'")) {
        const row = Array(22).fill("");
        Object.assign(row, { 0: "Pat", 1: "Lee", 2: "pat@example.com", 3: "555-0100", 4: "2", 19: "PayPal", 20: "Paid", 21: "$70" });
        return HttpResponse.json({ values: [["First"], row] });
      }
      if (String(params.range).includes("Auction-Status")) return HttpResponse.json({ values: [["Live"]] });
      return HttpResponse.json({ values: [] });
    }));

    const res = await request(app).get("/api/attendees/badges").set(volunteerSession());

    expect(res.status).toBe(200);
    expect(res.body.attendees).toEqual([expect.objectContaining({ sheet: "tickets", rowIndex: 2, firstName: "Pat", lastName: "Lee", paymentStatus: "Paid" })]);
    const text = JSON.stringify(res.body);
    for (const secret of ["pat@example.com", "555-0100", "PayPal", "$70"]) expect(text).not.toContain(secret);
  });

  it("can ask what changed, so their screen refreshes live like staff's", async () => {
    const res = await request(app).get("/api/changes?since=0").set(volunteerSession());
    expect(res.status).toBe(200);
  });

  it("recording that a volunteer was seen never brings back a removed record (ROADMAP A10)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    volunteerService.touchVolunteer("v1", 1_000_000);
    await new Promise((r) => setImmediate(r));
    expect(fake.docs("volunteers").get("v1")!.lastSeenAt).toEqual(expect.any(String));

    fake.docs("volunteers").delete("v1");
    volunteerService.touchVolunteer("v1", 2_000_000);
    await new Promise((r) => setImmediate(r));
    expect(fake.docs("volunteers").has("v1")).toBe(false);
    warn.mockRestore();
  });

  it("is told only about Bid Management undos, not Users/Tickets/Settings ones that name staff and attendees (ROADMAP A9)", async () => {
    const { announce, _resetChangeFeedForTesting } = await import("../utils/changeFeed");
    _resetChangeFeedForTesting();
    announce("dan@orns.org undid an action: Checked in bidder 104.", "dan@orns.org", "Bid Management");
    announce("dan@orns.org undid an action: sam@orns.org: Administrator -> User.", "dan@orns.org", "Users");
    announce("dan@orns.org undid an action: Added Pat Lee to tickets.", "dan@orns.org", "Tickets");

    const volunteer = await request(app).get("/api/changes?since=0").set(volunteerSession());
    const staff = await request(app).get("/api/changes?since=0").set(admin);

    expect(volunteer.body.notices.map((n: any) => n.area)).toEqual(["Bid Management"]);
    expect(staff.body.notices).toHaveLength(3);
  });

  it.each([
    ["another spreadsheet", "GET", `/api/sheets/other-sheet/${encodeURIComponent("A1:B2")}`, {}],
    ["Settings", "GET", "/api/paypal-sweeper/status", {}],
    ["a walk-in (not in the volunteers' list)", "POST", "/api/bidders/walk-in", { spreadsheetId: "bm" }],
    ["item editing", "POST", "/api/auction/update-item", { spreadsheetId: "it" }],
    ["the Action History", "GET", "/api/action-history", {}],
  ])("is refused %s", async (_label, method, path, body) => {
    const req = method === "GET" ? request(app).get(path) : request(app).post(path).send(body);
    const res = await req.set(volunteerSession());
    expect(res.status).toBe(403);
  });

  it("can't point a winning bid at another spreadsheet: the auction's own is used, whatever the request says (ROADMAP A13)", async () => {
    const touched = new Set<string>();
    server.use(http.all(`${SHEETS}/:id/*`, ({ params }) => { touched.add(String(params.id)); return HttpResponse.json({ values: [["ID"]] }); }));

    await request(app).post("/api/auction/record-winning-bid").set(volunteerSession())
      .send({ spreadsheetId: "elsewhere", bidderId: "101", itemId: "301", price: 50, bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", idempotencyKey: "k" });

    expect(touched.has("elsewhere")).toBe(false);
    expect(touched.has("bm")).toBe(true);
  });

  it("can't point the setup check at another spreadsheet through the query string (ROADMAP B10)", async () => {
    const touched = new Set<string>();
    server.use(http.all(`${SHEETS}/:id`, ({ params }) => { touched.add(String(params.id)); return HttpResponse.json({ sheets: [] }); }));
    server.use(http.all(`${SHEETS}/:id/*`, ({ params }) => { touched.add(String(params.id)); return HttpResponse.json({ values: [["Live"]] }); }));

    await request(app).get("/api/bidders/setup-status").query({ spreadsheetId: "elsewhere" }).set(volunteerSession());

    expect(touched.has("elsewhere")).toBe(false);
    expect(touched.has("bm")).toBe(true);
  });

  it("gets no setup check from the query string while the Config has no spreadsheet (ROADMAP B10)", async () => {
    fake.docs("settings").set("global", { ...fake.docs("settings").get("global"), bidManagementSpreadsheetId: "" });
    const touched = new Set<string>();
    server.use(http.all(`${SHEETS}/:id`, ({ params }) => { touched.add(String(params.id)); return HttpResponse.json({ sheets: [] }); }));

    const res = await request(app).get("/api/bidders/setup-status").query({ spreadsheetId: "elsewhere" }).set(volunteerSession());

    expect(touched.has("elsewhere")).toBe(false);
    expect(res.status).not.toBe(200);
  });

  it("gets no spreadsheet at all from the request while the Config has none set", async () => {
    fake.docs("settings").set("global", { ...fake.docs("settings").get("global"), bidManagementSpreadsheetId: "" });
    const touched = new Set<string>();
    server.use(http.all(`${SHEETS}/:id/*`, ({ params }) => { touched.add(String(params.id)); return HttpResponse.json({ values: [["Live"]] }); }));

    const res = await request(app).post("/api/bidders/set-flag").set(volunteerSession())
      .send({ spreadsheetId: "elsewhere", bidderNumbersSheet: "Bidder-Numbers", bidderId: "101", flag: "checkedIn" });

    expect(touched.has("elsewhere")).toBe(false);
    expect(res.status).not.toBe(200);
  });

  it.each([
    ["revoked", () => fake.docs("volunteers").set("v1", { ...fake.docs("volunteers").get("v1"), status: "revoked" })],
    ["the auction closed", () => { auctionCell = "Closed"; }],
    ["deleted", () => fake.docs("volunteers").delete("v1")],
  ])("is signed out (401, volunteer_access_ended) once %s", async (_label, change) => {
    change();
    const res = await request(app).get(`/api/sheets/bm/${encodeURIComponent("A1")}`).set(volunteerSession());
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe("volunteer_access_ended");
    expect((await request(app).get("/auth/status").set(volunteerSession())).body).toEqual({ authenticated: false, reason: "volunteer_access_ended" });
  });
});

describe("connecting the shared volunteer account", () => {
  async function connectAs(email: string, refreshToken: string | undefined = "new-volunteer-refresh") {
    server.use(
      http.post("https://oauth2.googleapis.com/token", () => HttpResponse.json({ access_token: "a", refresh_token: refreshToken, token_type: "Bearer" })),
      http.get("https://www.googleapis.com/oauth2/v2/userinfo", () => HttpResponse.json({ email, hd: "orns.org", verified_email: true }))
    );
    const agent = request.agent(app);
    agent.jar.setCookie(admin.Cookie.split("; ")[0]);
    agent.jar.setCookie(admin.Cookie.split("; ")[1]);
    const start = await agent.get("/auth/volunteer-account/connect");
    const state = new URL(start.headers.location).searchParams.get("state") as string;
    expect(new URL(start.headers.location).searchParams.get("login_hint")).toBe("auction-volunteers@orns.org");
    const res = await agent.get(`/auth/callback?code=c&state=${encodeURIComponent(state)}`);
    return { agent, res };
  }

  it("stores that account's sign-in for volunteers and keeps the admin signed in as themselves", async () => {
    const { agent, res } = await connectAs("auction-volunteers@orns.org");

    expect(res.status).toBe(200);
    expect(fake.docs("system").get("volunteerAuth")).toMatchObject({ refreshToken: "new-volunteer-refresh", email: "auction-volunteers@orns.org", connectedBy: TEST_ADMIN_EMAIL });
    expect((await agent.get("/auth/status")).body.user.email).toBe(TEST_ADMIN_EMAIL);
  });

  it("refuses a different account", async () => {
    const { res } = await connectAs("someone@orns.org");
    expect(res.status).toBe(403);
    expect(fake.docs("system").get("volunteerAuth")!.refreshToken).toBe("volunteer-refresh");
  });

  it("is Full Administrator only", async () => {
    const res = await request(app).get("/auth/volunteer-account/connect").set(authCookieHeader(tokens, "sam@orns.org"));
    expect(res.status).toBe(403);
  });
});

describe("closing the auction", () => {
  it("ends every invited or active volunteer's access", async () => {
    const real = await vi.importActual<typeof import("../services/volunteerService")>("../services/volunteerService");
    addVolunteer("a", { status: "active" });
    addVolunteer("b", { status: "invited", tokenHash: "h" });
    addVolunteer("c", { status: "revoked" });

    expect(await real.deactivateAllVolunteers("auction_closed")).toBe(2);
    expect(fake.docs("volunteers").get("a")).toMatchObject({ status: "deactivated", deactivatedReason: "auction_closed" });
    expect(fake.docs("volunteers").get("b")).toMatchObject({ status: "deactivated", tokenHash: "" });
    expect(fake.docs("volunteers").get("c")!.status).toBe("revoked");
  });
});
