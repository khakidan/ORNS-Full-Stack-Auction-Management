import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { app } from "../app";
import { authCookieHeader } from "./helpers/session";

describe("Route Integration Tests", () => {
  describe("GET /api/health", () => {
    it("returns 200 with status field and no-cache headers", async () => {
      const response = await request(app).get("/api/health");
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok" });
      expect(response.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate, private"
      );
    });
  });

  describe("GET /auth/status", () => {
    it("returns authenticated: false when no session is present", async () => {
      const response = await request(app).get("/auth/status");
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ authenticated: false });
    });
  });

  describe("GET /api/sheets/:spreadsheetId/:range", () => {
    const spreadsheetId = "test-spreadsheet-id";
    const range = "Sheet1!A1:B2";

    it("returns 401 when no auth header or session is present", async () => {
      const response = await request(app)
        .get(`/api/sheets/${spreadsheetId}/${range}`);
      
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Unauthorized");
    });

    const mockTokens = {
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      expiry_date: Date.now() + 3600000
    };

    it("returns 401 for a token blob sent in the retired x-google-tokens header - only the session cookie authenticates", async () => {
      const response = await request(app)
        .get(`/api/sheets/${spreadsheetId}/${range}`)
        .set("x-google-tokens", JSON.stringify(mockTokens));

      expect(response.status).toBe(401);
    });

    it("returns 200 and data with a valid orns_session cookie", async () => {
      const response = await request(app)
        .get(`/api/sheets/${spreadsheetId}/${range}`)
        .set(authCookieHeader(mockTokens));

      // If we get a 500, let's see the error
      if (response.status === 500) {
        console.error("Route Test 500 Error:", response.body);
      }

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("values");
      expect(Array.isArray(response.body.values)).toBe(true);
      expect(response.body.values[0]).toEqual(["Header1", "Header2"]);
    });
  });
});
