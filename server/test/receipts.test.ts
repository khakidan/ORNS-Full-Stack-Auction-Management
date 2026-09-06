/**
 * Test suite for the Receipts and Email Generation workflow.
 * Covers single and bulk receipt generation via Apps Script, as well as email dispatch endpoints.
 *
 * NOTE: This suite uses a shared `emailSheetHandler` mock which returns realistic 
 * Bidder-Numbers, Bid-Management, and Auction-Items data structures so that the 
 * `email-all` and `email-only` handlers operate with successfully built receipt data.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, appsScriptCallCount,
         productionScriptCallLog } from "./handlers";
import { calculatePayPalSurcharge } from "../utils/financeUtils";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = { "x-google-tokens": JSON.stringify(mockTokens) };

// Shared GET handler override for email tests — provides realistic sheet data
// that processEmail needs to build and send a receipt
const emailSheetHandler = http.get(
  'https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range',
  ({ request }) => {
    const url = new URL(request.url);
    const range = decodeURIComponent(url.pathname.split('/').pop() || '');

    if (range.includes('Bid-Management')) {
      return HttpResponse.json({
        values: [
          ['42', 'Price'],   // row 0: header — bidder 42 is at column index 0
          ['', ''],          // row 1: skipped
          ['', ''],          // row 2: skipped
          ['801', '50']      // row 3: bidder 42 won item 801 for $50
        ]
      });
    }
    if (range.includes('Bidder-Numbers')) {
      return HttpResponse.json({
        values: [
          ['ID', 'First Name', 'Last Name', 'Email', 'Phone', 'Checked In',
           'Checked Out', 'Is Paid', 'Invoice URL', 'Invoice Total', 'Fee Status', 'Timestamp'],
          ['42', 'John', 'Doe', 'john@example.com', '555-0199',
           'TRUE', 'TRUE', 'TRUE', 'https://paypal.me/test', '', '', '']
        ]
      });
    }
    if (range.includes('Auction-Items')) {
      return HttpResponse.json({
        values: [
          ['Item Number', 'Category', 'Item Name', 'Description', 'Value', 'Opening Bid',
           'Min Raise', 'Donated By', 'Type', 'Status', 'Bundle ID', 'Date'],
          ['801', 'Food', 'Pizza Night', 'A pizza dinner', '$50.00', '$22.50',
           '$5.00', "Joe's Pizza", 'Certificate', 'Active', '', '']
        ]
      });
    }
    return HttpResponse.json({ values: [] });
  }
);

// ─── Receipt Generation ───────────────────────────────────────────────────────

describe('Receipt Generate workflow', () => {
  beforeEach(() => {
    resetHandlersState();
    server.use(emailSheetHandler);
  });

  afterEach(() => {
    server.resetHandlers();
    resetHandlersState();
  });

  it('Happy path — calls apiCreateIndividualReceipt via Apps Script', async () => {
    const response = await request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42', emailReceipt: false, spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(appsScriptCallCount).toBe(1);
    expect(productionScriptCallLog).toContain('apiCreateIndividualReceipt');
  });

  it('Happy path — emailReceipt flag and Node-resolved receipt data are forwarded to Apps Script', async () => {
    let capturedScriptBody: any = null;

    server.use(
      emailSheetHandler,
      http.post(
        'https://script.googleapis.com/v1/scripts/:scriptId\\:run',
        async ({ request }) => {
          capturedScriptBody = await request.clone().json().catch(() => null);
          return HttpResponse.json({
            response: { result: { success: true } }
          });
        }
      )
    );

    const response = await request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42', emailReceipt: true, spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(200);
    expect(capturedScriptBody).not.toBeNull();
    const requestBody = capturedScriptBody?.requestBody ?? capturedScriptBody;
    expect(requestBody.function).toBe("apiCreateIndividualReceipt");
    // Node resolves the receipt itself now (see receiptDataService.ts)
    // instead of Class_ReceiptManager.gs looking it up a second,
    // independent way - see refactor-opportunities.md's Code Hardening
    // item #2 / CHANGELOG.md. folderID (3rd position) is still never
    // wired through from Node.
    const expectedTotal = calculatePayPalSurcharge(50).total;
    expect(requestBody.parameters).toEqual([
      "42",
      true,
      null,
      {
        bidId: "42",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        itemsWon: ["801"],
        itemNames: ["Pizza Night"],
        itemPrices: [50],
        totalCost: 50,
        // Node now also resolves the bidder's PayPal invoice itself
        // (Code Hardening item #2, Step 2) - the mock Bidder-Numbers row's
        // existing "https://paypal.me/test" invoice URL has no matching
        // invoiced amount, so this hits the cancel-stale-and-recreate path
        // against the default PayPal sandbox mocks in handlers.ts.
        paymentUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2-MOCK-0000-0000-0001",
        adjustedTotal: expectedTotal
      }
    ]);
  });

  it('Auth failure', async () => {
    const response = await request(app)
      .post('/api/receipts/generate')
      .send({ bidderId: '42', emailReceipt: false, spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });
    expect(response.status).toBe(401);
    expect(appsScriptCallCount).toBe(0);
  });

  it('SCRIPT_ID_BID_MANAGEMENT not configured — returns 500', async () => {
    const originalId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    delete process.env.SCRIPT_ID_BID_MANAGEMENT;

    const response = await request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42', emailReceipt: false, spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('SCRIPT_ID_BID_MANAGEMENT');

    process.env.SCRIPT_ID_BID_MANAGEMENT = originalId;
  });

  it('Missing spreadsheetId — returns 400', async () => {
    const response = await request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42', emailReceipt: false });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('spreadsheetId required');
  });
});

// ─── Generate All Receipts ────────────────────────────────────────────────────

describe('Receipt Generate-All workflow', () => {
  beforeEach(() => {
    resetHandlersState();
    server.use(emailSheetHandler);
  });

  afterEach(() => {
    server.resetHandlers();
    resetHandlersState();
  });

  it('Happy path — calls apiCreateAllReceipts via Apps Script', async () => {
    const response = await request(app)
      .post('/api/receipts/generate-all')
      .set(authHeader)
      .send({ spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(appsScriptCallCount).toBe(1);
    expect(productionScriptCallLog).toContain('apiCreateAllReceipts');
  });

  it('Auth failure', async () => {
    const response = await request(app)
      .post('/api/receipts/generate-all')
      .send({ spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });
    expect(response.status).toBe(401);
    expect(appsScriptCallCount).toBe(0);
  });

  it('SCRIPT_ID_BID_MANAGEMENT not configured — returns 500', async () => {
    const originalId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    delete process.env.SCRIPT_ID_BID_MANAGEMENT;

    const response = await request(app)
      .post('/api/receipts/generate-all')
      .set(authHeader)
      .send({ spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(500);
    process.env.SCRIPT_ID_BID_MANAGEMENT = originalId;
  });

  it('Missing spreadsheetId — returns 400', async () => {
    const response = await request(app)
      .post('/api/receipts/generate-all')
      .set(authHeader)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('spreadsheetId required');
  });
});

// ─── Email All ────────────────────────────────────────────────────────────────

describe('Receipt Email-All workflow', () => {
  beforeEach(() => {
    resetHandlersState();
    server.use(emailSheetHandler);
  });

  afterEach(() => {
    server.resetHandlers();
    resetHandlersState();
  });

  it('Happy path — reads bidder list and sends emails, returns sentCount', async () => {
    const response = await request(app)
      .post('/api/receipts/email-all')
      .set(authHeader)
      .send({ spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    // One bidder with a valid email exists in the mock Bidder-Numbers sheet
    expect(response.body.sentCount).toBe(1);
  });

  it('Auth failure', async () => {
    const response = await request(app)
      .post('/api/receipts/email-all')
      .send({ spreadsheetId: 'test-spreadsheet-id' });
    expect(response.status).toBe(401);
  });

  it('Missing spreadsheetId — returns 400', async () => {
    const response = await request(app)
      .post('/api/receipts/email-all')
      .set(authHeader)
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('spreadsheetId required');
  });
});

// ─── Email Only (single bidder) ───────────────────────────────────────────────

describe('Receipt Email-Only workflow', () => {
  beforeEach(() => {
    resetHandlersState();
    server.use(emailSheetHandler);
  });

  afterEach(() => {
    server.resetHandlers();
    resetHandlersState();
  });

  it('Happy path — sends email for a single bidder', async () => {
    const response = await request(app)
      .post('/api/receipts/email-only')
      .set(authHeader)
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('Bidder not found in Bidder-Numbers — returns 400', async () => {
    const response = await request(app)
      .post('/api/receipts/email-only')
      .set(authHeader)
      .send({ bidderId: '999', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('No email address found');
  });

  it('Auth failure', async () => {
    const response = await request(app)
      .post('/api/receipts/email-only')
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id' });
    expect(response.status).toBe(401);
  });

  it('Missing spreadsheetId — returns 400', async () => {
    const response = await request(app)
      .post('/api/receipts/email-only')
      .set(authHeader)
      .send({ bidderId: '42' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('spreadsheetId required');
  });
});