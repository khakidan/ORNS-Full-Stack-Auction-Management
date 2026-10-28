import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { authCookieHeader, sessionCookie, TEST_ADMIN_EMAIL } from "./helpers/session";

/** In-memory `users` collection standing in for Firestore. */
const usersDocs = new Map<string, Record<string, unknown>>();
/** Set to make every read fail, like an expired local Google login. */
let failReads = false;
vi.mock("../services/firebaseAdmin", () => ({
  getAdminFirestore: () => ({
    collection: () => ({
      doc: (id: string) => ({
        get: async () => {
          if (failReads) throw new Error("invalid_rapt");
          return { data: () => usersDocs.get(id) };
        },
        set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          usersDocs.set(id, opts?.merge ? { ...(usersDocs.get(id) || {}), ...data } : data);
        },
      }),
      get: async () => ({ docs: [...usersDocs.entries()].map(([id, d]) => ({ id, data: () => d })) }),
    }),
  }),
}));
vi.mock("../services/paypalSweeperJob", async (importActual) => ({
  ...(await importActual<typeof import("../services/paypalSweeperJob")>()),
  persistSweeperCredential: vi.fn().mockResolvedValue(undefined),
}));

import { app } from "../app";
import { _resetUserCacheForTesting, getRole } from "../services/userService";

const tokens = { access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 };
const as = (email: string) => authCookieHeader(tokens, email);

beforeEach(() => {
  usersDocs.clear();
  failReads = false;
  _resetUserCacheForTesting();
});

describe("getRole", () => {
  it("makes a FULL_ADMIN_EMAILS address a Full Administrator, an assigned address its role, and anyone else a User", async () => {
    usersDocs.set("jane@orns.org", { role: "admin" });

    expect(await getRole(TEST_ADMIN_EMAIL)).toBe("full_admin");
    expect(await getRole("Jane@ORNS.org")).toBe("admin");
    expect(await getRole("sam@orns.org")).toBe("user");
  });

  it("ignores an unrecognized stored role rather than granting anything", async () => {
    usersDocs.set("odd@orns.org", { role: "superuser" });
    expect(await getRole("odd@orns.org")).toBe("user");
  });
});

describe("GET /auth/status", () => {
  it("reports the signed-in person, their role and what they can do", async () => {
    usersDocs.set("jane@orns.org", { role: "admin" });

    const res = await request(app).get("/auth/status").set(as("jane@orns.org"));

    expect(res.body).toEqual({
      authenticated: true,
      user: { email: "jane@orns.org", role: "admin", roleLabel: "Administrator", capabilities: ["settings", "users.manage", "auction.stage", "tickets.edit", "attendees.delete", "bidders.walkIn"] },
    });
  });

  it("treats a session from before roles existed (no email) as signed out", async () => {
    const res = await request(app).get("/auth/status").set({ Cookie: sessionCookie({ tokens }) });
    expect(res.body).toEqual({ authenticated: false });
  });
});

describe("sign-in", () => {
  async function signInAs(email: string) {
    server.use(
      http.post("https://oauth2.googleapis.com/token", () => HttpResponse.json({ access_token: "a", token_type: "Bearer" })),
      http.get("https://www.googleapis.com/oauth2/v2/userinfo", () => HttpResponse.json({ email, hd: "orns.org", verified_email: true }))
    );
    const agent = request.agent(app);
    const state = new URL((await agent.get("/auth/url")).body.url).searchParams.get("state") as string;
    const res = await agent.get(`/auth/callback?code=c&state=${encodeURIComponent(state)}`);
    return { agent, res };
  }

  it("remembers who signed in and records the sign-in for the Users tab", async () => {
    const { agent } = await signInAs("Sam@orns.org");
    await new Promise((r) => setImmediate(r));

    expect((await agent.get("/auth/status")).body.user).toMatchObject({ email: "sam@orns.org", role: "user" });
    expect(usersDocs.get("sam@orns.org")).toMatchObject({ email: "sam@orns.org", lastLoginAt: expect.any(String) });
  });

  it("refuses the shared volunteer account as a normal app sign-in", async () => {
    const { res, agent } = await signInAs("auction-volunteers@orns.org");

    expect(res.status).toBe(403);
    expect(res.text).toContain("shared volunteer account");
    expect((await agent.get("/auth/status")).body.authenticated).toBe(false);
  });
});

describe("permissions on routes", () => {
  it.each([
    ["POST", "/api/auction/go-live", { spreadsheetId: "s" }],
    ["POST", "/api/auction/close-and-cleanup", { spreadsheetId: "s", bidderNumbersSheet: "B", bidManagementSheet: "M" }],
    ["POST", "/api/bidders/sync", { spreadsheetId: "s" }],
    ["POST", "/api/attendees/delete", { spreadsheetId: "s", sheet: "tickets", rowIndex: 5 }],
    ["POST", "/api/auction/setup-new", {}],
  ])("a User is refused %s %s (Admin-only)", async (_m, path, body) => {
    const res = await request(app).post(path).set(as("sam@orns.org")).send(body);
    expect(res.status).toBe(403);
  });

  it("a User can't change roles", async () => {
    const res = await request(app).put("/api/users/pat%40orns.org/role").set(as("sam@orns.org")).send({ role: "admin" });
    expect(res.status).toBe(403);
  });

  it.each([
    ["/api/attendees/add", { spreadsheetId: "s", sheet: "tickets", row: ["Pat"] }],
    ["/api/attendees/update", { spreadsheetId: "s", range: "'tickets'!A5", values: [["Pat"]] }],
    ["/api/production/tickets/bidder-labels", { folderId: "f" }],
  ])("the Auction Tickets page is view-only for a User: %s is refused", async (path, body) => {
    const res = await request(app).post(path).set(as("sam@orns.org")).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("view-only");
  });

  it.each([
    ["GET", "/api/users"],
    ["GET", "/api/action-history/status"],
  ])("an Administrator can use the Settings tabs they see: %s %s", async (method, path) => {
    usersDocs.set("jane@orns.org", { role: "admin" });
    const res = await (method === "GET" ? request(app).get(path) : request(app).post(path).send({})).set(as("jane@orns.org"));
    expect(res.status).not.toBe(403);
  });

  it.each([
    ["GET", "/api/paypal-sweeper/status"],
    ["POST", "/api/paypal-sweeper/run-now"],
    ["GET", "/api/apps-script/versions"],
    ["GET", "/api/bug-reports/list?spreadsheetId=s"],
    ["POST", "/api/bug-reports/resolve"],
  ])("an Administrator is refused the Full-Administrator-only route %s %s (PayPal, Apps Script, Bug Reports)", async (method, path) => {
    usersDocs.set("jane@orns.org", { role: "admin" });
    const req = method === "GET" ? request(app).get(path) : request(app).post(path).send({});
    const res = await req.set(as("jane@orns.org"));
    expect(res.status).toBe(403);
  });

  it("lets an Administrator delete an attendee row, and only a ticket tab's data row", async () => {
    usersDocs.set("jane@orns.org", { role: "admin" });
    const cleared: string[] = [];
    server.use(http.post("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", ({ params }) => {
      cleared.push(decodeURIComponent(String(params.range)));
      return HttpResponse.json({});
    }));

    const ok = await request(app).post("/api/attendees/delete").set(as("jane@orns.org")).send({ spreadsheetId: "s", sheet: "staff tickets", rowIndex: 7 });
    const badSheet = await request(app).post("/api/attendees/delete").set(as("jane@orns.org")).send({ spreadsheetId: "s", sheet: "Bid-Management", rowIndex: 7 });
    const header = await request(app).post("/api/attendees/delete").set(as("jane@orns.org")).send({ spreadsheetId: "s", sheet: "tickets", rowIndex: 1 });

    expect(ok.status).toBe(200);
    expect(cleared).toEqual(["'staff tickets'!A7:Z7:clear"]);
    expect(badSheet.status).toBe(400);
    expect(header.status).toBe(400);
  });

  it("has no generic sheets clear, so the attendee permission can't be bypassed - with or without a tab name", async () => {
    for (const range of ["tickets!A5:Z5", "A5:Z5"]) {
      const res = await request(app).post(`/api/sheets/s/${encodeURIComponent(range)}/clear`).set(as("sam@orns.org")).send({});
      expect(res.status).toBe(404);
    }
  });

  it("still lets a User do everyday work (a route with no extra permission)", async () => {
    const res = await request(app).get("/api/bidders/setup-status").set(as("sam@orns.org"));
    expect(res.status).not.toBe(403);
  });
});

describe("Users API", () => {
  it("lists staff with FULL_ADMIN_EMAILS addresses marked as set on the server", async () => {
    usersDocs.set("jane@orns.org", { email: "jane@orns.org", role: "admin" });
    usersDocs.set("sam@orns.org", { email: "sam@orns.org", lastLoginAt: "2026-10-01T00:00:00Z" });

    const res = await request(app).get("/api/users").set(as(TEST_ADMIN_EMAIL));

    expect(res.body.users.map((u: any) => [u.email, u.role, u.bootstrap])).toEqual([
      [TEST_ADMIN_EMAIL, "full_admin", true],
      ["jane@orns.org", "admin", false],
      ["sam@orns.org", "user", false],
    ]);
  });

  it("assigns and removes a role, and the change applies to that person's next request", async () => {
    await request(app).get("/api/bidders/setup-status").set(as("sam@orns.org")); // caches sam as User

    const put = await request(app).put("/api/users/sam%40orns.org/role").set(as(TEST_ADMIN_EMAIL)).send({ role: "admin" });

    expect(put.status).toBe(200);
    expect(usersDocs.get("sam@orns.org")).toMatchObject({ role: "admin", assignedBy: TEST_ADMIN_EMAIL });
    expect((await request(app).get("/auth/status").set(as("sam@orns.org"))).body.user.role).toBe("admin");

    await request(app).put("/api/users/sam%40orns.org/role").set(as(TEST_ADMIN_EMAIL)).send({ role: "user" });
    expect((await request(app).get("/auth/status").set(as("sam@orns.org"))).body.user.role).toBe("user");
  });

  it.each([
    ["a non-ORNS address", "pat%40gmail.com", "admin", "@orns.org"],
    ["an unknown role", "sam%40orns.org", "owner", "Role must be"],
    ["a FULL_ADMIN_EMAILS address", encodeURIComponent(TEST_ADMIN_EMAIL), "user", "set on the server"],
  ])("refuses %s", async (_label, email, role, message) => {
    const res = await request(app).put(`/api/users/${email}/role`).set(as(TEST_ADMIN_EMAIL)).send({ role });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(message);
  });

  it("refuses changing your own role", async () => {
    usersDocs.set("boss@orns.org", { role: "full_admin" });
    const res = await request(app).put("/api/users/boss%40orns.org/role").set(as("boss@orns.org")).send({ role: "user" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("your own role");
  });
});

describe("getRole when Firestore is failing", () => {
  it("treats the person as a User and logs the failure at most once a minute, not on every request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    failReads = true;
    try {
      expect(await getRole("a@orns.org", 0)).toBe("user");
      await getRole("b@orns.org", 1_000);
      await getRole("c@orns.org", 30_000);
      await getRole("d@orns.org", 61_000);

      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1][0])).toContain("2 more like this");
    } finally {
      warn.mockRestore();
    }
  });
});
