import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, lastBulkWritePayload } from "./handlers";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

describe("Ticket Payment Status workflow", () => {
  beforeEach(() => {
    process.env.SCRIPT_ID_BID_MANAGEMENT = "dummy-bid-management-script-id";
  });

  afterEach(() => {
    resetHandlersState();
    server.resetHandlers();
  });

  it("Happy path — check-in adds ticket bid then checkout marks attendee paid", async () => {
    const putPayloads: any[][][] = [];
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "First Name", "Last Name", "Email", "Phone", "Checked In", "Checked Out", "Is Paid", "Invoice URL", "Invoice Total Amount", "PayPal Fee Status", "Checkout Timestamp"],
              ["1001", "John", "Doe", "john@example.com", "555-0199", "FALSE", "FALSE", "FALSE", "", "", "", ""]
            ]
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
        if (range.includes("tickets")) {
          return HttpResponse.json({
            values: [["Header"]]
          });
        }
        return HttpResponse.json({ values: [] });
      }),
      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ request }) => {
        try {
          const body = await request.clone().json() as any;
          if (body.values) {
            putPayloads.push(body.values);
          }
        } catch (e) {}
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    // Step 1: POST check-in-with-bid
    const step1Response = await request(app)
      .post("/api/auction/check-in-with-bid")
      .set(authHeader)
      .send({
        bidderId: "1001",
        spreadsheetId: "test-spread-id",
        bidManagementSheet: "Bid-Management",
        bidderNumbersSheet: "Bidder-Numbers",
        bidValue: 35,
        ticketsSpreadsheetId: "test-tickets-id",
        ticketPrice: "35",
        idempotencyKey: crypto.randomUUID()
      });

    expect(step1Response.status).toBe(200);
    expect(step1Response.body.success).toBe(true);
    expect(step1Response.body.bidAdded).toBe(true);
    
    // Assert the MSW write payload shows the ticket price was written to correct location
    const hasTicketBid = putPayloads.some(values => 
      values.some(row => row.includes("1606") && (row.includes(35) || row.includes("35")))
    );
    expect(hasTicketBid).toBe(true);

    // Step 2: POST checkout-mark-paid
    const step2Response = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send({
        bidderId: "1001",
        spreadsheetId: "test-spread-id",
        ticketsSpreadsheetId: "test-tickets-id",
        bidderNumbersSheet: "Bidder-Numbers",
        attendeeInfo: { sheet: "tickets", rowIndex: 2 },
        paymentMethod: "cash",
        idempotencyKey: crypto.randomUUID()
      });

    expect(step2Response.status).toBe(200);
    expect(step2Response.body.success).toBe(true);
    expect(step2Response.body.attendeeUpdated).toBe(true);

    // Assert putPayloads contains "Paid" written to correct column in tickets spreadsheet
    const hasPaidUpdate = putPayloads.some(values => 
      values.some(row => row.includes("Paid"))
    );
    expect(hasPaidUpdate).toBe(true);
  });

  it("Checkout without tickets spreadsheet — attendeeUpdated is false", async () => {
    const response = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send({
        bidderId: "1001",
        spreadsheetId: "test-spread-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "cash",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.attendeeUpdated).toBe(false);
  });

  it("Auth failure (check-in) — returns 401 when unauthenticated", async () => {
    const response = await request(app)
      .post("/api/auction/check-in-with-bid")
      .send({
        bidderId: "1001",
        spreadsheetId: "test-spread-id",
        bidManagementSheet: "Bid-Management",
        bidderNumbersSheet: "Bidder-Numbers",
        bidValue: 35,
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(401);
  });

  it("Auth failure (checkout) — returns 401 when unauthenticated", async () => {
    const response = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .send({
        bidderId: "1001",
        spreadsheetId: "test-spread-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "cash",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(401);
  });
});

describe('Guest Bidder Number Assignment workflow', () => {
  const spreadsheetId = 'sync-spread-id';
  const ticketsSpreadsheetId = 'sync-tickets-id';

  beforeEach(() => {
    resetHandlersState();
  });

  afterEach(() => {
    resetHandlersState();
    server.resetHandlers();
  });

  it('Happy path — flagged guest receives bidder number', async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        
        if (range.includes("Settings")) {
          return HttpResponse.json({
            values: [
              ["Setting Key", "Value"],
              ["ticketPrice", "35"]
            ]
          });
        }
        if (range.includes("tickets")) {
          return HttpResponse.json({
            values: [
              ["First Name", "Last Name", "Email", "P1", "P2", "P3", "Guest Marker", "G1 First", "G1 Last", "G1 Email", "G1 Own Num"],
              ["Alice", "One", "alice@example.com", "", "", "", "Has Guest", "Bob", "One", "bob@example.com", "yes"],
              ["Charlie", "Two", "charlie@example.com", "", "", "", "Has Guest", "David", "Two", "david@example.com", "no"]
            ]
          });
        }
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid", "Payment Method", "Invoice URL", "Invoiced Amount"]
            ]
          });
        }
        return HttpResponse.json({ values: [] });
      }),
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId', () => {
        return HttpResponse.json({
          sheets: [
            { properties: { title: "Bidder-Numbers", sheetId: 101 } },
            { properties: { title: "Bid-Management", sheetId: 102 } },
            { properties: { title: "Auction-Items", sheetId: 103 } }
          ]
        });
      }),
      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ request }) => {
        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname);
        try {
          const body = await request.clone().json() as any;
          if (body.values && body.values.length > 0 && pathname.includes('Bidder-Numbers')) {
            lastBulkWritePayload.splice(0, lastBulkWritePayload.length, ...body.values);
          }
        } catch (e) {}
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const response = await request(app)
      .post('/api/bidders/sync')
      .set(authHeader)
      .send({
        spreadsheetId,
        auctionImportSheetID: 'dummy-import',
        auctionTicketSheetsID: ticketsSpreadsheetId
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(lastBulkWritePayload).toBeDefined();
    
    const bobRow = lastBulkWritePayload.find(row => row[1] === "Bob" && row[2] === "One");
    expect(bobRow).toBeDefined();
    expect(Number(bobRow[0])).toBe(103); // Alice (101) + Charlie (102) + Bob (103)
    expect(bobRow[3]).toBe("bob@example.com");

    const davidRow = lastBulkWritePayload.find(row => row[1] === "David" && row[2] === "Two");
    expect(davidRow).toBeUndefined();
  });

  it('Guest without flag is not assigned bidder number', async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        
        if (range.includes("Settings")) {
          return HttpResponse.json({
            values: [
              ["Setting Key", "Value"],
              ["ticketPrice", "35"]
            ]
          });
        }
        if (range.includes("tickets")) {
          return HttpResponse.json({
            values: [
              ["First Name", "Last Name", "Email", "P1", "P2", "P3", "Guest Marker", "G1 First", "G1 Last", "G1 Email", "G1 Own Num"],
              ["Alice", "One", "alice@example.com", "", "", "", "Has Guest", "Bob", "One", "bob@example.com", "no"],
              ["Charlie", "Two", "charlie@example.com", "", "", "", "Has Guest", "David", "Two", "david@example.com", "no"]
            ]
          });
        }
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid", "Payment Method", "Invoice URL", "Invoiced Amount"]
            ]
          });
        }
        return HttpResponse.json({ values: [] });
      }),
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId', () => {
        return HttpResponse.json({
          sheets: [
            { properties: { title: "Bidder-Numbers", sheetId: 101 } },
            { properties: { title: "Bid-Management", sheetId: 102 } },
            { properties: { title: "Auction-Items", sheetId: 103 } }
          ]
        });
      }),
      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ request }) => {
        const url = new URL(request.url);
        const pathname = decodeURIComponent(url.pathname);
        try {
          const body = await request.clone().json() as any;
          if (body.values && body.values.length > 0 && pathname.includes('Bidder-Numbers')) {
            lastBulkWritePayload.splice(0, lastBulkWritePayload.length, ...body.values);
          }
        } catch (e) {}
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const response = await request(app)
      .post('/api/bidders/sync')
      .set(authHeader)
      .send({
        spreadsheetId,
        auctionImportSheetID: 'dummy-import',
        auctionTicketSheetsID: ticketsSpreadsheetId
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(lastBulkWritePayload).toBeDefined();

    const aliceRow = lastBulkWritePayload.find(row => row[1] === "Alice");
    const charlieRow = lastBulkWritePayload.find(row => row[1] === "Charlie");
    expect(aliceRow).toBeDefined();
    expect(charlieRow).toBeDefined();

    const bobRow = lastBulkWritePayload.find(row => row[1] === "Bob");
    const davidRow = lastBulkWritePayload.find(row => row[1] === "David");
    expect(bobRow).toBeUndefined();
    expect(davidRow).toBeUndefined();
  });

  it('Auth failure', async () => {
    const response = await request(app)
      .post('/api/bidders/sync')
      .send({
        spreadsheetId,
        auctionImportSheetID: 'dummy-import',
        auctionTicketSheetsID: ticketsSpreadsheetId
      });

    expect(response.status).toBe(401);
  });
});

describe('Update Attendee Field workflow', () => {
  const spreadsheetId = 'test-spreadsheet-id';
  
  beforeEach(() => {
    resetHandlersState();
    
    // Override sheets update so we can populate lastBulkWritePayload at the correct column index
    server.use(
      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ params, request }) => {
        const range = String(params.range || '');
        const body = await request.json() as any;
        const val = body.values?.[0]?.[0];

        // Let's decode the range to see what column letter it is
        // E.g. "'tickets'!A2" or "'staff tickets'!R2"
        const decodedRange = decodeURIComponent(range);
        const colPart = decodedRange.split('!')[1]?.replace(/[0-9]/g, '') || '';

        // Column to mapped index (0-based)
        const colMap: Record<string, number> = {
          A: 0, B: 1, C: 2, D: 3, R: 17, U: 20
        };

        const colIdx = colMap[colPart];
        if (colIdx !== undefined) {
          const mockRow = new Array(25).fill("");
          mockRow[colIdx] = val;
          lastBulkWritePayload.splice(0, lastBulkWritePayload.length, mockRow);
        } else {
          lastBulkWritePayload.splice(0, lastBulkWritePayload.length, [val]);
        }

        return HttpResponse.json({ updatedRows: 1 });
      })
    );
  });

  afterEach(() => {
    resetHandlersState();
    server.resetHandlers();
  });

  const updatableFields = [
    { field: "firstName", colIndex: 0, value: "test-first-name" },
    { field: "lastName", colIndex: 1, value: "test-last-name" },
    { field: "email", colIndex: 2, value: "test-email" },
    { field: "phone", colIndex: 3, value: "test-phone" },
    { field: "paymentStatus", colIndex: 20, value: "Paid" }
  ];

  updatableFields.forEach(({ field, colIndex, value }) => {
    it(`should update field "${field}" and locate the correct value in lastBulkWritePayload`, async () => {
      const response = await request(app)
        .post("/api/tickets/update-attendee")
        .set(authHeader)
        .set("idempotency-key", crypto.randomUUID())
        .send({
          spreadsheetId,
          sheet: "tickets",
          rowIndex: 2,
          field,
          value
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(lastBulkWritePayload).toBeDefined();
      expect(lastBulkWritePayload[0][colIndex]).toBe(value);
    });
  });

  it("Auth failure: POST without auth header", async () => {
    const response = await request(app)
      .post("/api/tickets/update-attendee")
      .set("idempotency-key", crypto.randomUUID())
      .send({
        spreadsheetId,
        sheet: "tickets",
        rowIndex: 2,
        field: "firstName",
        value: "test-first-name"
      });

    expect(response.status).toBe(401);
  });

  it("Missing required fields: POST without rowIndex", async () => {
    const response = await request(app)
      .post("/api/tickets/update-attendee")
      .set(authHeader)
      .set("idempotency-key", crypto.randomUUID())
      .send({
        spreadsheetId,
        sheet: "tickets",
        field: "firstName",
        value: "test-first-name"
      });

    expect(response.status).toBe(400);
  });

  it("Invalid field name: POST with invalid field", async () => {
    const response = await request(app)
      .post("/api/tickets/update-attendee")
      .set(authHeader)
      .set("idempotency-key", crypto.randomUUID())
      .send({
        spreadsheetId,
        sheet: "tickets",
        rowIndex: 2,
        field: "nonExistentField",
        value: "test-value"
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Invalid field");
  });

  it("Different sheet sources: staff sheet attendee", async () => {
    let lastPutUrl = "";
    server.use(
      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ params, request }) => {
        lastPutUrl = decodeURIComponent(request.url);
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const response = await request(app)
      .post("/api/tickets/update-attendee")
      .set(authHeader)
      .set("idempotency-key", crypto.randomUUID())
      .send({
        spreadsheetId: "test-spreadsheet",
        sheet: "staff tickets",
        rowIndex: 2,
        field: "paymentStatus",
        value: "Paid"
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(lastPutUrl).toContain("test-spreadsheet/values/'staff tickets'!R2");
  });

  it("Different sheet sources: sponsor sheet attendee", async () => {
    let lastPutUrl = "";
    server.use(
      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ params, request }) => {
        lastPutUrl = decodeURIComponent(request.url);
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const response = await request(app)
      .post("/api/tickets/update-attendee")
      .set(authHeader)
      .set("idempotency-key", crypto.randomUUID())
      .send({
        spreadsheetId: "test-spreadsheet",
        sheet: "sponsor tickets",
        rowIndex: 2,
        field: "paymentStatus",
        value: "Paid"
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(lastPutUrl).toContain("test-spreadsheet/values/'sponsor tickets'!R2");
  });
});