/**
 * The Google tokens in the orns_session cookie are encrypted, not just
 * signed (ROADMAP B6): a copy of the cookie doesn't hand over a refresh
 * token that works on Google directly.
 */
import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { sessionCookie } from "./helpers/session";
import { sealTokens, unsealTokens } from "../utils/sealedSessionTokens";

vi.mock("../services/paypalSweeperJob", () => ({ persistSweeperCredential: vi.fn(async () => {}) }));
vi.mock("../services/userService", async (importActual) => ({
  ...(await importActual<typeof import("../services/userService")>()),
  recordLogin: vi.fn(async () => {}),
}));

import { app } from "../app";

const TOKENS = { access_token: "ya29.secret-access", refresh_token: "1//secret-refresh", expiry_date: Date.now() + 3600000 };

/** A cookie signed the way cookie-session signs it, with whatever body we choose. */
function rawCookie(body: Record<string, unknown>): string {
  const value = Buffer.from(JSON.stringify(body)).toString("base64");
  const sig = crypto.createHmac("sha1", process.env.SESSION_SECRET as string).update(`orns_session=${value}`).digest("base64")
    .replace(/\//g, "_").replace(/\+/g, "-").replace(/=/g, "");
  return `orns_session=${value}; orns_session.sig=${sig}`;
}

describe("sealTokens / unsealTokens", () => {
  it("round-trips, and the sealed text doesn't contain the tokens", () => {
    const sealed = sealTokens(TOKENS);
    expect(sealed).not.toContain("secret");
    expect(unsealTokens(sealed)).toEqual(TOKENS);
  });

  it("gives nothing back for tampered or foreign text", () => {
    const sealed = sealTokens(TOKENS);
    const [iv, tag, data] = sealed.split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(unsealTokens(`${iv}.${tag}.${flipped.toString("base64url")}`)).toBeUndefined();
    expect(unsealTokens("not-sealed")).toBeUndefined();
    expect(unsealTokens(undefined)).toBeUndefined();
  });
});

describe("the orns_session cookie", () => {
  it("after sign-in holds the tokens only in encrypted form, and the session works", async () => {
    server.use(
      http.post("https://oauth2.googleapis.com/token", () => HttpResponse.json({ ...TOKENS, token_type: "Bearer" })),
      http.get("https://www.googleapis.com/oauth2/v2/userinfo", () => HttpResponse.json({ email: "test@orns.org", hd: "orns.org", verified_email: true })),
    );
    const agent = request.agent(app);
    const start = await agent.get("/auth/url");
    const state = new URL(start.body.url).searchParams.get("state") as string;

    const callback = await agent.get(`/auth/callback?code=c&state=${encodeURIComponent(state)}`);

    const cookie = String(callback.headers["set-cookie"]).match(/orns_session=([^;]+)/)![1];
    const body = JSON.parse(Buffer.from(cookie, "base64").toString("utf8"));
    expect(body).not.toHaveProperty("tokens");
    expect(typeof body.sealedTokens).toBe("string");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect((await agent.get("/auth/status")).body.authenticated).toBe(true);
  });

  it("works for a request carrying sealed tokens", async () => {
    const res = await request(app).get("/auth/status").set({ Cookie: sessionCookie({ tokens: TOKENS, email: "test@orns.org" }) });
    expect(res.body.authenticated).toBe(true);
  });

  it.each([
    ["plaintext tokens (a cookie from before this change - that person signs in once more)", { tokens: TOKENS, email: "test@orns.org" }],
    ["sealed tokens that don't decrypt", { sealedTokens: "AAAA.BBBB.CCCC", email: "test@orns.org" }],
  ])("treats %s as signed out", async (_label, body) => {
    const res = await request(app).get("/api/users").set({ Cookie: rawCookie(body) });
    expect(res.status).toBe(401);
  });
});
