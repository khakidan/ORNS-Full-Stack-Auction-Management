import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { authCookieHeader } from "./helpers/session";

const mockTokens = {
  access_token: "mock-access-token",
  refresh_token: "mock-refresh-token",
  expiry_date: Date.now() + 3600000
};

const authHeader = authCookieHeader(mockTokens);

describe("Proxy Route Integration Tests", () => {

  describe("GET /api/drive/files/:folderId", () => {
    it("Happy path — returns file list for a valid folder ID", async () => {
      const response = await request(app)
        .get("/api/drive/files/folder-123")
        .set(authHeader);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty("id", "folder-123");
    });

    it("Missing or invalid folder ID (undefined/null/empty string) — returns empty array", async () => {
      const responseUndefined = await request(app)
        .get("/api/drive/files/undefined")
        .set(authHeader);

      expect(responseUndefined.status).toBe(200);
      expect(responseUndefined.body).toEqual([]);

      const responseNull = await request(app)
        .get("/api/drive/files/null")
        .set(authHeader);

      expect(responseNull.status).toBe(200);
      expect(responseNull.body).toEqual([]);
    });

    it("Non-existent folder ID causing 404 from Google Drive — returns 404 error", async () => {
      // Mock the google drive endpoint to return 404
      server.use(
        http.get("https://www.googleapis.com/drive/v3/files", () => {
          return new HttpResponse(
            JSON.stringify({
              error: {
                code: 404,
                message: "Folder not found"
              }
            }),
            { status: 404 }
          );
        })
      );

      const response = await request(app)
        .get("/api/drive/files/non-existent-id")
        .set(authHeader);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain("Folder not found");
    });
  });

  describe("GET /api/drive/files/:folderId - query injection (ROADMAP.md L7)", () => {
    it("rejects a folder ID that isn't a plain Drive ID, without querying Drive", async () => {
      let driveCalled = false;
      server.use(
        http.get("https://www.googleapis.com/drive/v3/files", () => {
          driveCalled = true;
          return HttpResponse.json({ files: [] });
        })
      );

      const response = await request(app)
        .get(`/api/drive/files/${encodeURIComponent("x' in parents or name contains '")}`)
        .set(authHeader);

      expect(response.status).toBe(400);
      expect(driveCalled).toBe(false);
    });
  });

  describe("GET /api/sheets/:spreadsheetId/:range - cache is per user (ROADMAP.md L5)", () => {
    it("doesn't serve one user's cached read to another user", async () => {
      const otherUserHeader = authCookieHeader({ access_token: "other-access-token", refresh_token: "other-refresh-token", expiry_date: Date.now() + 3600000 });
      const tokensSeen: string[] = [];
      server.use(
        http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
          const auth = request.headers.get("authorization") || "";
          tokensSeen.push(auth);
          if (auth.includes("other-access-token")) {
            return HttpResponse.json({ error: { code: 403, message: "The caller does not have permission" } }, { status: 403 });
          }
          return HttpResponse.json({ range: "Secret!A1:B2", values: [["salary", "100"]] });
        })
      );

      const first = await request(app).get("/api/sheets/private-sheet-L5/Secret!A1:B2").set(authHeader);
      expect(first.status).toBe(200);
      expect(first.body.values).toEqual([["salary", "100"]]);

      // Within the 5s TTL, a different user asks for the same range.
      const second = await request(app).get("/api/sheets/private-sheet-L5/Secret!A1:B2").set(otherUserHeader);
      expect(second.body.values).toBeUndefined();
      expect(tokensSeen).toHaveLength(2);

      // The first user still gets their cached copy.
      const third = await request(app).get("/api/sheets/private-sheet-L5/Secret!A1:B2").set(authHeader);
      expect(third.body.values).toEqual([["salary", "100"]]);
      expect(tokensSeen).toHaveLength(2);
    });
  });

  describe("POST /api/sheets/:spreadsheetId/:range", () => {
    it("Happy path — writes values to the given range, returns success", async () => {
      const response = await request(app)
        .post("/api/sheets/test-spreadsheet-id/Sheet1!A1:B2")
        .set(authHeader)
        .send({ values: [["hello", "world"]] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("updatedRows");
    });

    it("Missing body — returns 400", async () => {
      const response = await request(app)
        .post("/api/sheets/test-spreadsheet-id/Sheet1!A1:B2")
        .set(authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Missing body values");
    });
  });

  describe("POST /api/sheets/:spreadsheetId/:range/append", () => {
    it("Happy path — appends values to the range, returns success", async () => {
      const response = await request(app)
        .post("/api/sheets/test-spreadsheet-id/Sheet1!A1:B2/append")
        .set(authHeader)
        .send({ values: [["appended", "value"]] });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("updates");
    });

    it("Missing body — returns 400", async () => {
      const response = await request(app)
        .post("/api/sheets/test-spreadsheet-id/Sheet1!A1:B2/append")
        .set(authHeader)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Missing body values");
    });
  });

  describe("POST /api/sheets passthrough - sheets with their own locked routes are refused", () => {
    const cases: [string, string][] = [
      ["write", "/api/sheets/test-spreadsheet-id/Auction-Items!E2"],
      ["write", "/api/sheets/test-spreadsheet-id/'Bidder-Numbers'!E5"],
      ["write", "/api/sheets/test-spreadsheet-id/bid-management!A1"],
      ["append", "/api/sheets/test-spreadsheet-id/Follow-Up!A:C/append"],
      ["write", "/api/sheets/test-spreadsheet-id/Special-Winners!B2"],
      ["clear", "/api/sheets/test-spreadsheet-id/Bidder-Numbers!A2:Z2/clear"],
    ];
    for (const [kind, url] of cases) {
      it(`refuses a ${kind} to ${url.split("/")[4]} with 403, without calling Google`, async () => {
        let googleCalled = false;
        server.use(
          http.put("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", () => { googleCalled = true; return HttpResponse.json({}); }),
          http.post("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", () => { googleCalled = true; return HttpResponse.json({}); }),
        );
        const response = await request(app).post(encodeURI(url)).set(authHeader).send({ values: [["x"]] });

        expect(response.status).toBe(403);
        expect(response.body.error).toMatch(/can only be changed through the app's own save actions/);
        expect(googleCalled).toBe(false);
      });
    }

    it("still allows a write to a ticket sheet (attendee edits)", async () => {
      const response = await request(app)
        .post("/api/sheets/test-spreadsheet-id/tickets!C4")
        .set(authHeader)
        .send({ values: [["guest@example.com"]] });

      expect(response.status).toBe(200);
    });
  });

  describe("POST /api/sheets/:spreadsheetId/:range/clear", () => {
    it("Happy path — clears the range, returns success", async () => {
      const response = await request(app)
        .post("/api/sheets/test-spreadsheet-id/Sheet1!A1:B2/clear")
        .set(authHeader);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("clearedRange");
    });
  });
});
