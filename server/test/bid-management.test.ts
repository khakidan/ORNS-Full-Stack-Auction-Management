/**
 * Test suite for the Bid Management workflow.
 * Covers endpoints related to recording winning bids, checking out, walk-in registrations,
 * checking in with starting bids, and auction closing & cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, lastBulkWritePayload, updateCallCount,
         appendCallCount, appsScriptCallCount, lastAppendedRow,
         lastAppsScriptParams } from "./handlers";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

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
    expect(lastBulkWritePayload).not.toBeNull();
    expect(lastBulkWritePayload).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([validBody.itemId, validBody.price])
      ])
    );
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
    expect(lastAppendedRow).not.toBeNull();
    expect(lastAppendedRow[1]).toBe("John");
    expect(lastAppendedRow[2]).toBe("Doe");
    expect(lastAppendedRow[3]).toBe("john@example.com");
    expect(lastAppendedRow[4]).toBe(true);
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
    expect(updateCallCount).toBeGreaterThanOrEqual(1);
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

  // NOTE: POST /api/auction/check-in-with-bid is covered in the "Ticket Payment Status workflow" block.

  it("Auth failure — returns 401 when unauthenticated", async () => {
    const response = await request(app)
      .post("/api/auction/check-in-with-bid")
      .send({
        bidderId: "1001",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(401);
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
    expect(lastAppsScriptParams[0]).toBe("42");
    expect(lastAppsScriptParams[1]).toBe("cash");
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
    expect(lastAppsScriptParams[0]).toBe("42");
    expect(lastAppsScriptParams[1]).toBe("cash");
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
    expect(lastAppsScriptParams[0]).toBe("42");
    expect(lastAppsScriptParams[1]).toBe("credit_card");
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