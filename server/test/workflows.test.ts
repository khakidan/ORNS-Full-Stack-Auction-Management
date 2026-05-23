import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { appendCallCount, updateCallCount, lastAppendedRow, resetHandlersState } from "./handlers";

/**
 * COVERAGE MAP:
 * 
 * setupRoutes.ts:
 * - POST /api/auction/setup-new (Tested Happy Path & Negatives: invalid body, existing folder)
 * 
 * bidRoutes.ts:
 * - POST /api/auction/record-winning-bid (Tested Happy Path & Negatives: idempotency, missing bidder)
 * - POST /api/auction/checkout-mark-paid (Tested Happy Path with Apps Script bridge)
 * - POST /api/auction/close-and-cleanup (Tested Happy Path & Negatives: missing params)
 * - POST /api/bidders/walk-in (Tested Happy Path & Negatives: missing sheet names)
 * - POST /api/auction/check-in-with-bid (Tested Happy Path & Negatives: missing params)
 */

describe("Workflow Integration Tests", () => {
  const mockTokens = {
    access_token: "workflow-mock-token",
    refresh_token: "workflow-mock-refresh",
    expiry_date: Date.now() + 3600000
  };

  const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

  describe("setupRoutes - /api/auction/setup-new", () => {
    it("returns 401 when unauthenticated", async () => {
      const response = await request(app).post("/api/auction/setup-new");
      expect(response.status).toBe(401);
    });

    it("handles the happy path: full auction setup setup", async () => {
      // setup-new returns a stream of NDJSON
      const response = await request(app)
        .post("/api/auction/setup-new")
        .set(authHeader)
        .send({
          ticketsSpreadsheetId: "s1",
          itemEntrySpreadsheetId: "s2",
          bidManagementSpreadsheetId: "s3"
        });

      expect(response.status).toBe(200);
      expect(response.get("Content-Type")).toContain("application/x-ndjson");

      // Parse NDJSON response
      const lines = response.text.trim().split("\n");
      const results = lines.map(line => JSON.parse(line));

      expect(results).toContainEqual(expect.objectContaining({ log: expect.stringContaining("Starting setup") }));
      expect(results).toContainEqual(expect.objectContaining({ success: true }));
    });

    it("returns 400 for missing required spreadsheet IDs", async () => {
      const response = await request(app)
        .post("/api/auction/setup-new")
        .set(authHeader)
        .send({}); // Empty body

      expect(response.status).toBe(400);
      // We parse the text since it might stay NDJSON
      const body = response.body.error ? response.body : JSON.parse(response.text);
      expect(body.error).toContain("Missing required spreadsheet IDs");
    });

    it("halts if the auction folder already exists", async () => {
      // Use fake timers to control Date
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-12-01T00:00:00Z")); // Dec 2026 -> setup for 2027

      // Override Drive List to show existing folder for 2027
      server.use(
        http.get('https://www.googleapis.com/drive/v3/files', () => {
          return HttpResponse.json({
            files: [{ id: "existing-id", name: "2027 Auction", mimeType: "application/vnd.google-apps.folder" }]
          });
        })
      );

      const response = await request(app)
        .post("/api/auction/setup-new")
        .set(authHeader)
        .send({
          ticketsSpreadsheetId: "s1",
          itemEntrySpreadsheetId: "s2",
          bidManagementSpreadsheetId: "s3"
        });

      const lines = response.text.trim().split("\n");
      const results = lines.map(line => JSON.parse(line));
      
      expect(results).toContainEqual(expect.objectContaining({ 
        error: expect.stringContaining("already exists") 
      }));

      vi.useRealTimers();
    });
  });

  describe("bidRoutes - Legacy Compatibility & Error Handling", () => {
    it("handles a Google API 429 Rate Limit error gracefully via errorHandler middleware", async () => {
      // Simulate Google API rate limits throwing exceptions via MSW
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
          return new HttpResponse(
            JSON.stringify({ error: { message: "Quota exceeded for quota metric 'Read requests'", status: "RESOURCE_EXHAUSTED" } }),
            { status: 429 }
          );
        })
      );

      const response = await request(app)
        .post("/api/auction/close-and-cleanup")
        .set(authHeader)
        .send({
          spreadsheetId: "test-sheet-id",
          bidderNumbersSheet: "Bidder-Numbers",
          bidManagementSheet: "Bid-Management",
        });

      // The global errorHandler catch intercepts errors and outputs formatted JSON responses
      expect(response.status).toBe(500); 
      expect(response.body).toHaveProperty("message");
      expect(response.body.message).toContain("Quota exceeded");
    });
  });

  describe("bidRoutes - /api/auction/record-winning-bid", () => {
    const validBody = {
      bidderId: "1001",
      itemId: "I01",
      price: 100,
      spreadsheetId: "ss-id",
      bidManagementSheet: "Bid-Management",
      bidderNumbersSheet: "Bidder-Numbers",
      idempotencyKey: "unique-key-1"
    };

    // Shared mock generator for bidRoutes tests
    const setupBidMocks = () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = url.pathname.split('/').pop() || "";
          
          if (range.includes("Bidder-Numbers")) {
            return HttpResponse.json({
              values: [
                ["ID", "Name", "", "", "", "", "Checked Out"],
                ["1001", "Test User", "", "", "", "", false]
              ]
            });
          }
          if (range.includes("Bid-Management")) {
            return HttpResponse.json({
              values: [
                ["1001", "Price", "1002", "Price"],
                ["Total", "", "", ""],
                ["", "", "", ""],
                ["", "", "", ""] // Row 4
              ]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );
    };

    it("records a winning bid successfully", async () => {
      setupBidMocks();

      const response = await request(app)
        .post("/api/auction/record-winning-bid")
        .set(authHeader)
        .send({ ...validBody, idempotencyKey: "success-key-workflow" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("returns cached response for duplicate idempotency key", async () => {
      setupBidMocks();
      const key = "dup-key-workflow";
      
      // First request
      await request(app)
        .post("/api/auction/record-winning-bid")
        .set(authHeader)
        .send({ ...validBody, idempotencyKey: key });

      // Second request
      const response = await request(app)
        .post("/api/auction/record-winning-bid")
        .set(authHeader)
        .send({ ...validBody, idempotencyKey: key });

      expect(response.status).toBe(200);
      expect(response.body.duplicated).toBe(true);
    });

    it("returns 400 if bidder is not found", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
          return HttpResponse.json({ values: [["Header"], ["9999", "Other"]] });
        })
      );

      const response = await request(app)
        .post("/api/auction/record-winning-bid")
        .set(authHeader)
        .send({ ...validBody, idempotencyKey: "not-found-key-workflow" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Bidder 1001 not found");
    });
  });

  describe("bidRoutes - /api/auction/checkout-mark-paid", () => {
    it("calls Apps Script with correct parameters", async () => {
      let capturedBody: any = null;
      
      const scriptId = "mock-script-id";
      process.env.SCRIPT_ID_BID_MANAGEMENT = scriptId;

      server.use(
        http.post(`https://script.googleapis.com/v1/scripts/${scriptId}\\:run`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({
            response: { result: { success: true } }
          });
        })
      );

      const response = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .set(authHeader)
        .send({
          bidderId: "1001",
          spreadsheetId: "ss-id",
          bidderNumbersSheet: "Bidder-Numbers",
          paymentMethod: "CREDIT_CARD",
          amount: 105.50,
          idempotencyKey: "checkout-key-1"
        });

      expect(response.status).toBe(200);
      expect(capturedBody.function).toBe("apiRecordPayment");
      expect(capturedBody.parameters).toEqual(["1001", "CREDIT_CARD"]);
    });
  });

  describe("bidRoutes - /api/bidders/walk-in", () => {
    it("performs walk-in successfully", async () => {
      const response = await request(app)
        .post("/api/bidders/walk-in")
        .set(authHeader)
        .send({
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          spreadsheetId: "ss-id",
          bidderNumbersSheet: "Bidder-Numbers",
          bidManagementSheet: "Bid-Management",
          idempotencyKey: "walkin-key-1"
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.bidder.firstName).toBe("John");
    });

    it("returns 400 for missing required sheet names", async () => {
      const response = await request(app)
        .post("/api/bidders/walk-in")
        .set(authHeader)
        .send({
          firstName: "John",
          lastName: "Doe",
          spreadsheetId: "ss-id",
          idempotencyKey: "walkin-key-bad"
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Missing required fields for walk-in");
    });
  });

  describe("bidRoutes - /api/auction/close-and-cleanup", () => {
    it("closes auction and calculates winners successfully", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = url.pathname.split('/').pop() || "";
          if (range.includes("Bidder-Numbers")) {
            return HttpResponse.json({
              values: [
                ["ID", "Name", "", "", "Checked In", "", "Checked Out"],
                ["1001", "Winner", "", "", "TRUE", "", "FALSE"],
                ["1002", "Non-Winner", "", "", "TRUE", "", "FALSE"]
              ]
            });
          }
          if (range.includes("Bid-Management")) {
             return HttpResponse.json({
              values: [
                ["1001", "Price", "1002", "Price"],
                ["Total", "", "", ""],
                ["", "", "", ""],
                ["", "100", "", ""] // 1001 won something
              ]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const response = await request(app)
        .post("/api/auction/close-and-cleanup")
        .set(authHeader)
        .send({
          spreadsheetId: "ss-id",
          bidderNumbersSheet: "Bidder-Numbers",
          bidManagementSheet: "Bid-Management"
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("returns 400 for missing parameters", async () => {
      const response = await request(app)
        .post("/api/auction/close-and-cleanup")
        .set(authHeader)
        .send({ spreadsheetId: "ss-id" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Missing required spreadsheet parameters");
    });
  });

  describe("bidRoutes - /api/auction/check-in-with-bid", () => {
    const validCheckInBody = {
      bidderId: "1001",
      spreadsheetId: "ss-id",
      bidManagementSheet: "Bid-Management",
      bidderNumbersSheet: "Bidder-Numbers",
      bidValue: 50,
      idempotencyKey: "checkin-unique-1"
    };

    it("checks in a bidder and adds a bid successfully", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = url.pathname.split('/').pop() || "";
          if (range.includes("Bidder-Numbers")) {
            return HttpResponse.json({
              values: [["ID"], ["1001"]]
            });
          }
          if (range.includes("Bid-Management")) {
            return HttpResponse.json({
              values: [
                ["1001", "Price"],
                ["Total", ""],
                ["", ""],
                ["", ""]
              ]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const response = await request(app)
        .post("/api/auction/check-in-with-bid")
        .set(authHeader)
        .send(validCheckInBody);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.bidAdded).toBe(true);
    });

    it("returns 400 for missing parameters", async () => {
      const response = await request(app)
        .post("/api/auction/check-in-with-bid")
        .set(authHeader)
        .send({ bidderId: "1001" });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Missing required parameters");
    });
  });

  describe("Add Auction Item workflow", () => {
    const validItemBody = {
      spreadsheetId: "test-spreadsheet-id",
      category: "Food",
      name: "Dinner for Two",
      description: "A lovely dinner for two at a local restaurant.",
      value: "$100.00",
      donor: "Jane Smith",
      itemType: "Certificate",
      idempotencyKey: crypto.randomUUID()
    };

    afterEach(() => {
      resetHandlersState();
    });

    it("handles the happy path", async () => {
      const response = await request(app)
        .post("/api/auction/add-item")
        .set(authHeader)
        .send(validItemBody);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.assigned_id).toBe("802"); 
      
      expect(appendCallCount).toBeGreaterThan(0);
      
      // assert on lastAppendedRow
      expect(lastAppendedRow).toBeDefined();
      expect(lastAppendedRow[0]).toBe("802"); // ID
      expect(lastAppendedRow[1]).toBe("Food"); // Category
      expect(lastAppendedRow[2]).toBe("Dinner for Two"); // Name
      expect(lastAppendedRow[5]).toBe("$45.00"); // Opening Bid (45% of 100)
      expect(lastAppendedRow[9]).toBe("Active"); // Status
      expect(lastAppendedRow[10]).toBe(""); // Bundle ID
      expect(lastAppendedRow[11]).toBe(""); // Bundled Date
      expect(lastAppendedRow.length).toBe(12);
    });

    it("handles idempotency - duplicate submission", async () => {
      const key = crypto.randomUUID();
      const body = { ...validItemBody, idempotencyKey: key };
      
      const res1 = await request(app)
        .post("/api/auction/add-item")
        .set(authHeader)
        .send(body);
        
      const res2 = await request(app)
        .post("/api/auction/add-item")
        .set(authHeader)
        .send(body);

      expect(res2.status).toBe(200);
      expect(res2.body.duplicated).toBe(true);
      expect(updateCallCount).toBe(1);
    });

    it("returns 401 when unauthenticated", async () => {
      const response = await request(app)
        .post("/api/auction/add-item")
        .send(validItemBody);

      expect(response.status).toBe(401);
    });

    it("returns 400 for validation failure (missing name)", async () => {
      const invalidBody = { ...validItemBody, name: "" };
      const response = await request(app)
        .post("/api/auction/add-item")
        .set(authHeader)
        .send(invalidBody);

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it("returns 500 for external service failure", async () => {
      server.use(
        http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
          return new HttpResponse(null, { status: 500 });
        })
      );
      
      const response = await request(app)
        .post("/api/auction/add-item")
        .set(authHeader)
        .send({ ...validItemBody, idempotencyKey: crypto.randomUUID() });

      expect(response.status).toBe(500);
      expect(response.body.success).toBeUndefined();
    });
  });
});
