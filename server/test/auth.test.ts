import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};

const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

describe('Auth Routes workflow', () => {
  beforeEach(() => {
    server.resetHandlers();
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
