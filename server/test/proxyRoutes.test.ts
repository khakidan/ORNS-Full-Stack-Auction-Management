import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";

const mockTokens = {
  access_token: "mock-access-token",
  refresh_token: "mock-refresh-token",
  expiry_date: Date.now() + 3600000
};

const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

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
