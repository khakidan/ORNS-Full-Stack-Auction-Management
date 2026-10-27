import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { server } from "./setup";
import { http, HttpResponse } from "msw";

// Prevents the OAuth callback's best-effort PayPal-sweeper credential
// persist (authRoutes.ts -> paypalSweeperJob.ts -> firebaseAdmin.ts) from
// attempting a real Application Default Credentials network call during
// these tests - see paypalSweeperJob.test.ts for that logic's own
// coverage, fully mocked there instead.
const mockPersistSweeperCredential = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/paypalSweeperJob", () => ({
  persistSweeperCredential: (...args: unknown[]) => mockPersistSweeperCredential(...args),
}));

// The callback's best-effort sign-in record (userService.recordLogin) would
// otherwise try real Firestore.
const mockRecordLogin = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/userService", async (importActual) => ({
  ...(await importActual<typeof import("../services/userService")>()),
  recordLogin: (...args: unknown[]) => mockRecordLogin(...args),
}));

import { app } from "../app";
import { authCookieHeader } from "./helpers/session";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};

const authHeader = authCookieHeader(mockTokens);

/**
 * Starts sign-in the way the browser does - GET /auth/url, which stores a
 * one-time `state` in the session cookie - and returns an agent carrying
 * that cookie plus the state Google would echo back to the callback.
 */
async function startSignIn() {
  const agent = request.agent(app);
  const res = await agent.get('/auth/url');
  const state = new URL(res.body.url).searchParams.get('state') as string;
  return { agent, state };
}

async function completeSignIn(code = 'valid-code-123') {
  const { agent, state } = await startSignIn();
  return agent.get(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`);
}

describe('Auth Routes workflow', () => {
  beforeEach(() => {
    server.resetHandlers();
    mockPersistSweeperCredential.mockClear();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  describe('GET /auth/url', () => {
    it('Happy path — returns auth url', async () => {
      const response = await request(app).get('/auth/url');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('url');
      expect(typeof response.body.url).toBe('string');
      expect(response.body.url.startsWith('https://')).toBe(true);
    });
  });

  describe('GET /auth/callback', () => {
    it('Happy path — valid code, authorized domain', async () => {
      server.use(
        http.post('https://oauth2.googleapis.com/token', () => {
          return HttpResponse.json({
            access_token: "workflow-mock-token",
            refresh_token: "workflow-mock-refresh",
            expiry_date: Date.now() + 3600000,
            token_type: "Bearer"
          });
        }),
        http.get('https://www.googleapis.com/oauth2/v2/userinfo', () => {
          return HttpResponse.json({
            email: "test@orns.org",
            name: "Test User",
            hd: "orns.org",
            verified_email: true
          });
        })
      );

      const response = await completeSignIn();
      // An HTML page (not a 302) because the post-login return path lives
      // in the browser's sessionStorage (saved by useGoogleAuth.ts), which
      // only the page's inline script can read. The tokens go only into
      // the signed orns_session cookie.
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(String(response.headers['set-cookie'])).toContain("orns_session=");
      expect(response.text).toContain("post_auth_redirect_path");
      // Best-effort background-sync credential persist (Code Hardening
      // item #2, Step 4) - fires for any login that returns a
      // refresh_token, which this mock response always does.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockPersistSweeperCredential).toHaveBeenCalledWith("workflow-mock-refresh", "test@orns.org");
    });

    it('Never writes the OAuth tokens into the callback page - they live only in the httpOnly session cookie', async () => {
      server.use(
        http.post('https://oauth2.googleapis.com/token', () => {
          return HttpResponse.json({
            access_token: "workflow-mock-token",
            refresh_token: "workflow-mock-refresh",
            expiry_date: Date.now() + 3600000,
            token_type: "Bearer"
          });
        }),
        http.get('https://www.googleapis.com/oauth2/v2/userinfo', () => {
          return HttpResponse.json({ email: "test@orns.org", name: "Test User", hd: "orns.org", verified_email: true });
        })
      );

      const response = await completeSignIn();

      expect(response.status).toBe(200);
      expect(response.text).not.toContain("workflow-mock-token");
      expect(response.text).not.toContain("workflow-mock-refresh");
      expect(response.text).not.toContain("postMessage");
    });

    it('Rejected domain — non-org email', async () => {
      server.use(
        http.post('https://oauth2.googleapis.com/token', () => {
          return HttpResponse.json({
            access_token: "workflow-mock-token",
            refresh_token: "workflow-mock-refresh",
            expiry_date: Date.now() + 3600000,
            token_type: "Bearer"
          });
        }),
        http.get('https://www.googleapis.com/oauth2/v2/userinfo', () => {
          return HttpResponse.json({
            email: "user@gmail.com",
            name: "External User"
          });
        })
      );

      const { agent, state } = await startSignIn();
      const response = await agent.get(`/auth/callback?code=valid-code-123&state=${encodeURIComponent(state)}`);
      expect(response.status).toBe(403);
      expect(response.text).toContain("Access Denied: @orns.org required.");
      // The session cookie is rewritten (the used state is cleared) but never gains tokens.
      const status = await agent.get('/auth/status');
      expect(status.body.authenticated).toBe(false);
    });

    it('Missing code parameter', async () => {
      const { agent, state } = await startSignIn();
      const response = await agent.get(`/auth/callback?state=${encodeURIComponent(state)}`);
      expect(response.status).toBe(500);
    });

    it('Rejects a callback with no state, a wrong state, or no sign-in started from this browser (login CSRF, ROADMAP.md M2)', async () => {
      const tokenCalls = vi.fn();
      server.use(http.post('https://oauth2.googleapis.com/token', () => { tokenCalls(); return HttpResponse.json({ access_token: "attacker-token", token_type: "Bearer" }); }));

      const { agent, state } = await startSignIn();
      expect(state).toBeTruthy();

      const noState = await agent.get('/auth/callback?code=attacker-code');
      expect(noState.status).toBe(403);

      const { agent: agent2 } = await startSignIn();
      const wrongState = await agent2.get('/auth/callback?code=attacker-code&state=not-the-one');
      expect(wrongState.status).toBe(403);

      // A victim's browser that never started sign-in has no state at all.
      const noSession = await request(app).get(`/auth/callback?code=attacker-code&state=${encodeURIComponent(state)}`);
      expect(noSession.status).toBe(403);

      expect(tokenCalls).not.toHaveBeenCalled();
    });

    it('A state works once - replaying the same callback URL is rejected', async () => {
      const { agent, state } = await startSignIn();
      const first = await agent.get(`/auth/callback?code=valid-code-123&state=${encodeURIComponent(state)}`);
      expect(first.status).toBe(200);
      const replay = await agent.get(`/auth/callback?code=valid-code-123&state=${encodeURIComponent(state)}`);
      expect(replay.status).toBe(403);
    });

    it('Rejects an @orns.org address whose account is not in the orns.org Workspace (hd claim)', async () => {
      server.use(
        http.get('https://www.googleapis.com/oauth2/v2/userinfo', () => HttpResponse.json({ email: "someone@orns.org", verified_email: true }))
      );
      const response = await completeSignIn();
      expect(response.status).toBe(403);
      expect(response.text).toContain("Access Denied");
    });
  });

  describe('POST /auth/logout', () => {
    it('Happy path — clears session and returns success', async () => {
      const response = await request(app).post('/auth/logout').set(authHeader);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });

    it('No session — returns success even without auth header', async () => {
      const response = await request(app).post('/auth/logout');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });
  });
});
