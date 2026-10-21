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

import { app } from "../app";
import { authCookieHeader } from "./helpers/session";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};

const authHeader = authCookieHeader(mockTokens);

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
            name: "Test User"
          });
        })
      );

      const response = await request(app).get('/auth/callback?code=valid-code-123');
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
          return HttpResponse.json({ email: "test@orns.org", name: "Test User" });
        })
      );

      const response = await request(app).get('/auth/callback?code=valid-code-123');

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

      const response = await request(app).get('/auth/callback?code=valid-code-123');
      expect(response.status).toBe(403);
      expect(response.text).toContain("Access Denied: @orns.org required.");
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('Missing code parameter', async () => {
      const response = await request(app).get('/auth/callback');
      expect(response.status).toBe(500);
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
