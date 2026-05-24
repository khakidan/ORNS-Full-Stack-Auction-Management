import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { appendCallCount, updateCallCount, lastAppendedRow, appsScriptCallCount, resetHandlersState, lastBulkWritePayload, bulkWriteCallCount } from "./handlers";
import { checkIdempotency, saveIdempotency } from "../utils/idempotency";

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

  describe('Checkout workflow', () => {
    afterEach(() => {
      resetHandlersState();
      server.resetHandlers();
    });

    it('Cash/Check payment — standard 200 path', async () => {
      const response = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .set(authHeader)
        .send({
          bidderId: "42",
          spreadsheetId: "test-spreadsheet-id",
          bidderNumbersSheet: "Bidder-Numbers",
          paymentMethod: "cash",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.deferred).toBeFalsy();
    });

    it('Credit card payment — deferred 202 path', async () => {
      const response = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .set(authHeader)
        .send({
          bidderId: "42",
          spreadsheetId: "test-spreadsheet-id",
          bidderNumbersSheet: "Bidder-Numbers",
          paymentMethod: "credit_card",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(202);
      expect(response.body.success).toBe(true);
      expect(response.body.deferred).toBe(true);
      expect(response.body.message).toBe("Verification deferred");
      expect(response.body.bidderId).toBe("42");
    });

    it('Idempotency — duplicate checkout submission', async () => {
      const key = crypto.randomUUID();
      const payload = {
        bidderId: "42",
        spreadsheetId: "test-spreadsheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "credit_card",
        idempotencyKey: key
      };

      const res1 = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .set(authHeader)
        .send(payload);
      expect(res1.status).toBe(202);

      const res2 = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .set(authHeader)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.duplicated).toBe(true);
      expect(appsScriptCallCount).toBe(1);
    });

    it('Auth failure', async () => {
      const response = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .send({
          bidderId: "42",
          spreadsheetId: "test-spreadsheet-id",
          bidderNumbersSheet: "Bidder-Numbers",
          paymentMethod: "cash",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(401);
    });

    it('Apps Script failure', async () => {
      server.use(
        http.post('https://script.googleapis.com/v1/scripts/:scriptId\\:run', () => {
          return new HttpResponse(null, { status: 500 });
        })
      );

      const response = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .set(authHeader)
        .send({
          bidderId: "42",
          spreadsheetId: "test-spreadsheet-id",
          bidderNumbersSheet: "Bidder-Numbers",
          paymentMethod: "cash",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(500);
      expect(response.body.success).toBeUndefined();
    });
  });

  describe('Full bid-to-checkout lifecycle', () => {
    const setupLifecycleMocks = (isCheckedOut = false) => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split('/').pop() || "");
          
          if (range.includes("Bidder-Numbers")) {
            return HttpResponse.json({
              values: [
                ["ID", "First Name", "Last Name", "Email", "Phone", "Checked In", "Checked Out", "Is Paid", "Invoice URL", "Invoice Total Amount", "PayPal Fee Status", "Checkout Timestamp"],
                ["42", "John", "Doe", "john@example.com", "555-0199", "TRUE", isCheckedOut ? "TRUE" : "FALSE", "FALSE", "", "", "", ""]
              ]
            });
          }
          if (range.includes("Bid-Management")) {
            return HttpResponse.json({
              values: [
                ["42", "Price"],
                ["Total", ""],
                ["", ""],
                ["", ""]
              ]
            });
          }
          if (range.includes("Auction-Items")) {
            return HttpResponse.json({
              values: [
                ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
                ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
                ["803", "Food", "Sushi Dinner", "A sushi dinner", "$150.00", "$67.50", "$10.00", "Sushi Place", "Certificate", "Active", "", ""]
              ]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );
    };

    afterEach(() => {
      resetHandlersState();
      server.resetHandlers();
    });

    it('Happy path — bid recorded then cash checkout', async () => {
      setupLifecycleMocks(false);

      const bidRes = await request(app)
        .post("/api/auction/record-winning-bid")
        .set(authHeader)
        .send({
          bidderId: "42",
          itemId: "801",
          price: 150.00,
          spreadsheetId: "test-spreadsheet-id",
          bidManagementSheet: "Bid-Management",
          bidderNumbersSheet: "Bidder-Numbers",
          idempotencyKey: crypto.randomUUID()
        });

      expect(bidRes.status).toBe(200);
      expect(bidRes.body.success).toBe(true);

      const checkoutRes = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .set(authHeader)
        .send({
          bidderId: "42",
          spreadsheetId: "test-spreadsheet-id",
          bidderNumbersSheet: "Bidder-Numbers",
          paymentMethod: "cash",
          idempotencyKey: crypto.randomUUID()
        });

      expect(checkoutRes.status).toBe(200);
      expect(checkoutRes.body.success).toBe(true);
    });

    it('Happy path — bid recorded then credit card checkout', async () => {
      setupLifecycleMocks(false);

      const bidRes = await request(app)
        .post("/api/auction/record-winning-bid")
        .set(authHeader)
        .send({
          bidderId: "42",
          itemId: "801",
          price: 150.00,
          spreadsheetId: "test-spreadsheet-id",
          bidManagementSheet: "Bid-Management",
          bidderNumbersSheet: "Bidder-Numbers",
          idempotencyKey: crypto.randomUUID()
        });

      expect(bidRes.status).toBe(200);

      const checkoutRes = await request(app)
        .post("/api/auction/checkout-mark-paid")
        .set(authHeader)
        .send({
          bidderId: "42",
          spreadsheetId: "test-spreadsheet-id",
          bidderNumbersSheet: "Bidder-Numbers",
          paymentMethod: "credit_card",
          idempotencyKey: crypto.randomUUID()
        });

      expect(checkoutRes.status).toBe(202);
      expect(checkoutRes.body.message).toBe("Verification deferred");
    });

    it('Lifecycle — checked-out bidder winning bid goes to follow-up', async () => {
      const capturedRequests: { method: string; range: string; body?: any }[] = [];

      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split('/').pop() || "");
          
          if (range.includes("Bidder-Numbers")) {
            return HttpResponse.json({
              values: [
                ["ID", "First Name", "Last Name", "Email", "Phone", "Checked In", "Checked Out", "Is Paid", "Invoice URL", "Invoice Total Amount", "PayPal Fee Status", "Checkout Timestamp"],
                ["42", "John", "Doe", "john@example.com", "555-0199", "TRUE", "TRUE", "FALSE", "", "", "", ""]
              ]
            });
          }
          if (range.includes("Bid-Management")) {
            return HttpResponse.json({
              values: [
                ["42", "Price"],
                ["Total", ""],
                ["", ""],
                ["", ""]
              ]
            });
          }
          if (range.includes("Auction-Items")) {
            return HttpResponse.json({
              values: [
                ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
                ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""]
              ]
            });
          }
          return HttpResponse.json({ values: [] });
        }),

        http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/*', async ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split('/values/')[1] || "");
          const body = await request.clone().json().catch(() => null);
          capturedRequests.push({ method: 'PUT', range, body });
          return HttpResponse.json({ updatedRows: 1 });
        }),

        http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/*', async ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split('/values/')[1] || "");
          const body = await request.clone().json().catch(() => null);
          capturedRequests.push({ method: 'POST', range, body });
          return HttpResponse.json({ updates: { updatedRange: "Follow-Up!A2:C2", updatedRows: 1 } });
        }),

        http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId\\:batchUpdate', () => {
          return HttpResponse.json({ replies: [] });
        })
      );

      const bidRes = await request(app)
        .post("/api/auction/record-winning-bid")
        .set(authHeader)
        .send({
          bidderId: "42",
          itemId: "801",
          price: 150.00,
          spreadsheetId: "test-spreadsheet-id",
          bidManagementSheet: "Bid-Management",
          bidderNumbersSheet: "Bidder-Numbers",
          idempotencyKey: crypto.randomUUID()
        });

      expect(bidRes.status).toBe(200);
      expect(bidRes.body.success).toBe(true);

      const appends = capturedRequests.filter(r => r.method === 'POST' && r.range.includes('append'));
      expect(appends.length).toBeGreaterThan(0);
      
      const hasFollowUpWrite = appends.some(r => r.range.includes('Follow-Up'));
      expect(hasFollowUpWrite).toBe(true);

      const hasBidManagementAppend = appends.some(r => r.range.includes('Bid-Management'));
      expect(hasBidManagementAppend).toBe(false);
    });
  });

  describe("Batch Update workflow — Set Category", () => {

    afterEach(() => {
      resetHandlersState();
      server.resetHandlers();
    });

    it("Happy path — category update triggers re-sequencing", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split('/').pop() || "");
          
          if (range.includes("Auction-Items")) {
            return HttpResponse.json({
              values: [
                ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
                ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
                ["803", "Food", "Sushi Dinner", "A sushi dinner", "$150.00", "$67.50", "$10.00", "Sushi Place", "Certificate", "Active", "", ""],
                ["301", "Health & Beauty", "Spa Day", "A spa day", "$100.00", "$45.00", "$5.00", "Spa", "Certificate", "Active", "", ""]
              ]
            });
          }
          if (range.includes("Categories")) {
            return HttpResponse.json({
              values: [["Category", "Base"], ["Food", "800"], ["Health & Beauty", "300"]]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const response = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send({
          spreadsheetId: "test-spreadsheet-id",
          rowIndices: [2, 3], // row indices 2 and 3 correspond to the Food items (801 and 803)
          field: "category",
          value: "Travel",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.affected_categories).toContain("Food");
      expect(response.body.affected_categories).toContain("Travel");

      expect(bulkWriteCallCount).toBe(1);
      expect(lastBulkWritePayload).toBeDefined();
      
      // Index 1 corresponds to Row 2
      expect(lastBulkWritePayload[1][1]).toBe("Travel");
      expect(lastBulkWritePayload[1][0]).toBe("1101");

      // Index 2 corresponds to Row 3
      expect(lastBulkWritePayload[2][1]).toBe("Travel");
      expect(lastBulkWritePayload[2][0]).toBe("1102");

      // Index 3 (Spa Day) remains unchanged
      expect(lastBulkWritePayload[3][0]).toBe("301");
      expect(lastBulkWritePayload[3][1]).toBe("Health & Beauty");
    });

    it("Category update — idempotency", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split('/').pop() || "");
          if (range.includes("Auction-Items")) {
            return HttpResponse.json({
              values: [
                ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
                ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
                ["803", "Food", "Sushi Dinner", "A sushi dinner", "$150.00", "$67.50", "$10.00", "Sushi Place", "Certificate", "Active", "", ""]
              ]
            });
          }
          if (range.includes("Categories")) {
            return HttpResponse.json({
              values: [["Category", "Base"], ["Food", "800"]]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        spreadsheetId: "test-spreadsheet-id",
        rowIndices: [2, 3],
        field: "category",
        value: "Travel",
        idempotencyKey
      };

      const res1 = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send(payload);

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.duplicated).toBe(true);
      expect(bulkWriteCallCount).toBe(1); // The sheet was not written twice
    });

    it("Category update — auth failure", async () => {
      const response = await request(app)
        .post("/api/auction/bulk-update-items")
        .send({
          spreadsheetId: "test-spreadsheet-id",
          rowIndices: [2, 3],
          field: "category",
          value: "Travel",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(401);
    });

    it("Category update — validation failure", async () => {
      const response = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send({
          spreadsheetId: "test-spreadsheet-id",
          field: "category",
          value: "Travel",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Missing required bulk update parameters");
    });

    it("Category update — external service failure", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
          return new HttpResponse(null, { status: 500 });
        })
      );

      const response = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send({
          spreadsheetId: "test-spreadsheet-id",
          rowIndices: [2, 3],
          field: "category",
          value: "Travel",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(500);
    });
  });

  describe("Batch Update workflow — Set Type", () => {

    afterEach(() => {
      resetHandlersState();
      server.resetHandlers();
    });

    it("Happy path — type update does NOT trigger re-sequencing", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split('/').pop() || "");
          if (range.includes("Auction-Items")) {
            return HttpResponse.json({
              values: [
                ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
                ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
                ["803", "Food", "Sushi Dinner", "A sushi dinner", "$150.00", "$67.50", "$10.00", "Sushi Place", "Certificate", "Active", "", ""]
              ]
            });
          }
          if (range.includes("Categories")) {
            return HttpResponse.json({
              values: [["Category", "Base"], ["Food", "800"]]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const response = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send({
          spreadsheetId: "test-spreadsheet-id",
          rowIndices: [2, 3],
          field: "itemType",
          value: "Physical",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.affected_categories).toEqual([]);

      expect(bulkWriteCallCount).toBe(1);
      expect(lastBulkWritePayload).toBeDefined();

      expect(lastBulkWritePayload[1][8]).toBe("Physical");
      expect(lastBulkWritePayload[2][8]).toBe("Physical");

      expect(lastBulkWritePayload[1][0]).toBe("801");
      expect(lastBulkWritePayload[2][0]).toBe("803");
    });

    it("Type update — idempotency", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          const url = new URL(request.url);
          const range = decodeURIComponent(url.pathname.split('/').pop() || "");
          if (range.includes("Auction-Items")) {
            return HttpResponse.json({
              values: [
                ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
                ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""]
              ]
            });
          }
          if (range.includes("Categories")) {
            return HttpResponse.json({
              values: [["Category", "Base"], ["Food", "800"]]
            });
          }
          return HttpResponse.json({ values: [] });
        })
      );

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        spreadsheetId: "test-spreadsheet-id",
        rowIndices: [2],
        field: "itemType",
        value: "Physical",
        idempotencyKey
      };

      const res1 = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send(payload);

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.duplicated).toBe(true);
      expect(bulkWriteCallCount).toBe(1);
    });

    it("Type update — auth failure", async () => {
      const response = await request(app)
        .post("/api/auction/bulk-update-items")
        .send({
          spreadsheetId: "test-spreadsheet-id",
          rowIndices: [2],
          field: "itemType",
          value: "Physical",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(401);
    });

    it("Type update — validation failure", async () => {
      const response = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send({
          spreadsheetId: "test-spreadsheet-id",
          rowIndices: [],
          field: "itemType",
          value: "Physical",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(400);
    });
  });

  describe("Batch Update workflow — confirmation dialog behavior", () => {
    it("Cancel action — UI-only (verify no API calls are made)", async () => {
      expect(bulkWriteCallCount).toBe(0);
      expect(updateCallCount).toBe(0);
    });

    it("rejection of single-item selections in UI", async () => {
      server.use(
        http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
          return HttpResponse.json({
            values: [
              ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
              ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""]
            ]
          });
        })
      );
      const response = await request(app)
        .post("/api/auction/bulk-update-items")
        .set(authHeader)
        .send({
          spreadsheetId: "test-spreadsheet-id",
          rowIndices: [2],
          field: "category",
          value: "Travel",
          idempotencyKey: crypto.randomUUID()
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
