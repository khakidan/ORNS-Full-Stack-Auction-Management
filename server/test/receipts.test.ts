/**
 * Test suite for the Receipts and Email Generation workflow.
 * Covers single and bulk receipt generation via Apps Script, as well as email dispatch endpoints.
 *
 * NOTE: This suite uses a shared `emailSheetHandler` mock which returns realistic 
 * Bidder-Numbers, Bid-Management, and Auction-Items data structures so that the 
 * `email-all` and `email-only` handlers operate with successfully built receipt data.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getPaypalIsSandbox } from "../services/sharedConfig";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, appsScriptCallCount,
         productionScriptCallLog, lastAppsScriptParams } from "./handlers";
import { calculatePayPalSurcharge } from "../utils/financeUtils";
import { authCookieHeader } from "./helpers/session";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = authCookieHeader(mockTokens);

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
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(appsScriptCallCount).toBe(1);
    expect(productionScriptCallLog).toContain('apiCreateIndividualReceipt');
  });

  it('A second request for the same bidder while the first runs is turned away, and only one PayPal invoice is made (ROADMAP.md H1)', async () => {
    // Bidder-Numbers with no invoice yet, backed by state so the first
    // request's J/K write is visible to the second request's read.
    const bidderRow = ['42', 'John', 'Doe', 'john@example.com', 'TRUE', '', '', '', '', '', ''];
    let invoicesCreated = 0;
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const range = decodeURIComponent(new URL(request.url).pathname.split('/').pop() || '');
        if (range.includes('Bid-Management')) {
          return HttpResponse.json({ values: [['42', 'Price'], ['', ''], ['', ''], ['801', '50']] });
        }
        if (range.includes('Bidder-Numbers')) {
          return HttpResponse.json({ values: [['ID', 'First Name', 'Last Name', 'Email'], bidderRow] });
        }
        if (range.includes('Auction-Items')) {
          return HttpResponse.json({ values: [['Item Number', 'Category', 'Item Name'], ['801', 'Food', 'Pizza Night']] });
        }
        return HttpResponse.json({ values: [] });
      }),
      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ request }) => {
        const body: any = await request.clone().json();
        bidderRow[9] = body.values[0][0];
        bidderRow[10] = String(body.values[0][1]);
        return HttpResponse.json({ updatedRows: 1 });
      }),
      http.post('https://api-m.sandbox.paypal.com/v2/invoicing/invoices', async () => {
        invoicesCreated++;
        // Widen the race window - without the lock, both requests read
        // "no invoice yet" while this one is still in flight.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ id: 'INV2-MOCK-0000-0000-0001' }, { status: 201 });
      })
    );

    const send = () => request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });
    const [first, second] = await Promise.all([send(), send()]);

    // The second would make a duplicate receipt PDF, so it gets 409
    // instead of running after the first.
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(invoicesCreated).toBe(1);
    expect(appsScriptCallCount).toBe(1);

    // Once the first has finished, the bidder's receipt can be made again.
    expect((await send()).status).toBe(200);
  });

  it("The script reporting its own failure returns 400 with its reason, not a 200 'success'", async () => {
    server.use(
      http.post('https://script.googleapis.com/v1/scripts/:scriptId\\:run', () =>
        HttpResponse.json({ response: { result: { success: false, error: 'Exception: Document is missing' } } })
      )
    );

    const response = await request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Exception: Document is missing');
  });

  it("A failed script run reports the script's real error, not the generic 'ScriptError'", async () => {
    server.use(
      http.post('https://script.googleapis.com/v1/scripts/:scriptId\\:run', () =>
        HttpResponse.json({
          error: { code: 3, message: 'ScriptError', details: [{ errorMessage: 'Exceeded maximum execution time' }] }
        })
      )
    );

    const response = await request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Exceeded maximum execution time');
  });

  it('Happy path — Node-resolved receipt data is forwarded to Apps Script', async () => {
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
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(200);
    expect(capturedScriptBody).not.toBeNull();
    const requestBody = capturedScriptBody?.requestBody ?? capturedScriptBody;
    expect(requestBody.function).toBe("apiCreateIndividualReceipt");
    // Node resolves the receipt itself now (see receiptDataService.ts)
    // instead of Class_ReceiptManager.gs looking it up a second,
    // independent way - see CHANGELOG.md's Code Hardening
    // item #2 / CHANGELOG.md. folderID (2nd position) is null here because
    // the test Config has no receipt folder (see the B1 test below). No
    // `emailReceipt` parameter any more -
    // Step 5 deleted the GAS-side email path it gated, which nothing
    // ever actually triggered (the client always sent `false`).
    const expectedTotal = calculatePayPalSurcharge(50).total;
    expect(requestBody.parameters).toEqual([
      "42",
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

  it("files receipts in the Config's receipt folder, not the spreadsheet's own _Settings copy (ROADMAP B1)", async () => {
    const { getAdminFirestore } = await import("../services/firebaseAdmin");
    const { _resetConfigCacheForTesting } = await import("../services/configService");
    await getAdminFirestore().collection("settings").doc("global").set({ receiptFolderId: "this-years-receipts" });
    _resetConfigCacheForTesting();
    const runs: any[] = [];
    server.use(
      emailSheetHandler,
      http.post('https://script.googleapis.com/v1/scripts/:scriptId\\:run', async ({ request }) => {
        runs.push(await request.clone().json());
        return HttpResponse.json({ response: { result: { success: true } } });
      })
    );

    await request(app).post('/api/receipts/generate').set(authHeader)
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });
    await request(app).post('/api/receipts/generate-all').set(authHeader)
      .send({ spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id', part: 1 });

    expect(runs.map((r) => [r.function, r.parameters[0]])).toEqual([
      ["apiCreateIndividualReceipt", "42"],
      ...runs.slice(1).map(() => ["apiCreateAllReceipts", "this-years-receipts"]),
    ]);
    expect(runs[0].parameters[1]).toBe("this-years-receipts");
    expect(runs.length).toBeGreaterThan(1);
  });

  it('Auth failure', async () => {
    const response = await request(app)
      .post('/api/receipts/generate')
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });
    expect(response.status).toBe(401);
    expect(appsScriptCallCount).toBe(0);
  });

  it('SCRIPT_ID_BID_MANAGEMENT not configured — returns 500', async () => {
    const originalId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    delete process.env.SCRIPT_ID_BID_MANAGEMENT;

    const response = await request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('SCRIPT_ID_BID_MANAGEMENT');

    process.env.SCRIPT_ID_BID_MANAGEMENT = originalId;
  });

  it('Missing spreadsheetId — returns 400', async () => {
    const response = await request(app)
      .post('/api/receipts/generate')
      .set(authHeader)
      .send({ bidderId: '42' });

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
    expect(response.body).toMatchObject({ success: true, part: 1, totalParts: 1, bidderCount: 1, fileName: 'Receipts - Part 1 of 1 (Doe)' });
    expect(appsScriptCallCount).toBe(1);
    expect(productionScriptCallLog).toContain('apiCreateAllReceipts');
    // One named PDF for this part (the 3rd parameter).
    expect(lastAppsScriptParams[2]).toBe('Receipts - Part 1 of 1 (Doe)');
  });

  describe('printing in parts', () => {
    // 30 bidders, each winning one item: two parts (25 + 5).
    const BIDDERS = Array.from({ length: 30 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return { id: String(100 + i), first: `First${n}`, last: `Last${n}`, item: String(800 + i) };
    });
    const manyBiddersHandler = http.get(
      'https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range',
      ({ request }) => {
        const range = decodeURIComponent(new URL(request.url).pathname.split('/').pop() || '');
        if (range.includes('Bid-Management')) {
          return HttpResponse.json({
            values: [
              BIDDERS.flatMap((b) => [b.id, 'Price']),
              BIDDERS.flatMap(() => ['', '']),
              BIDDERS.flatMap(() => ['', '']),
              BIDDERS.flatMap((b) => [b.item, '10']),
            ]
          });
        }
        if (range.includes('Bidder-Numbers')) {
          return HttpResponse.json({ values: [['ID', 'First Name', 'Last Name', 'Email'], ...BIDDERS.map((b) => [b.id, b.first, b.last, ''])] });
        }
        if (range.includes('Auction-Items')) {
          return HttpResponse.json({ values: [['Item Number', 'Category', 'Item Name'], ...BIDDERS.map((b) => [b.item, 'Food', `Item ${b.item}`])] });
        }
        return HttpResponse.json({ values: [] });
      }
    );

    const printPart = (part?: number) => request(app)
      .post('/api/receipts/generate-all')
      .set(authHeader)
      .send({ spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id', ...(part === undefined ? {} : { part }) });

    beforeEach(() => {
      server.use(manyBiddersHandler);
    });

    it('sends at most 25 bidders per part, each part to its own named PDF', async () => {
      const first = await printPart(1);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ part: 1, totalParts: 2, bidderCount: 30, fileName: 'Receipts - Part 1 of 2 (Last01 - Last25)' });
      expect(lastAppsScriptParams[1]).toHaveLength(25);
      expect(lastAppsScriptParams[1][0].lastName).toBe('Last01');

      const second = await printPart(2);
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ part: 2, totalParts: 2, fileName: 'Receipts - Part 2 of 2 (Last26 - Last30)' });
      expect(lastAppsScriptParams[1].map((r: any) => r.lastName)).toEqual(['Last26', 'Last27', 'Last28', 'Last29', 'Last30']);
      expect(appsScriptCallCount).toBe(2);
    });

    it('defaults to part 1 when no part is given', async () => {
      const response = await printPart();
      expect(response.body).toMatchObject({ part: 1, totalParts: 2 });
    });

    it('rejects a part past the last one, without running the script', async () => {
      const response = await printPart(3);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('There are only 2 part(s) to print.');
      expect(appsScriptCallCount).toBe(0);
    });

    it('rejects a part that is not a whole number from 1', async () => {
      expect((await printPart(0)).status).toBe(400);
      expect(appsScriptCallCount).toBe(0);
    });

    it('turns away a second print while one is running', async () => {
      // A slow script run, so the second request arrives mid-run.
      server.use(
        http.post('https://script.googleapis.com/v1/scripts/:scriptId\\:run', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json({ response: { result: { success: true } } });
        })
      );
      const [a, b] = await Promise.all([printPart(1), printPart(1)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it("stops with the script's reason when a part fails", async () => {
      server.use(
        http.post('https://script.googleapis.com/v1/scripts/:scriptId\\:run', () =>
          HttpResponse.json({ response: { result: { success: false, error: 'Exception: Service Documents failed' } } })
        )
      );
      const response = await printPart(1);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Exception: Service Documents failed');
    });
  });

  it('No bidder has won anything — nothing to print, script not run', async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => HttpResponse.json({ values: [] }))
    );
    const response = await request(app)
      .post('/api/receipts/generate-all')
      .set(authHeader)
      .send({ spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, totalParts: 0 });
    expect(appsScriptCallCount).toBe(0);
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

  it('Uses the PayPal environment from Firestore, not the request body (ROADMAP.md M3)', async () => {
    vi.mocked(getPaypalIsSandbox).mockResolvedValueOnce(false);
    let liveHits = 0;
    let sandboxHits = 0;
    server.use(
      http.post('https://api-m.paypal.com/v1/oauth2/token', () => { liveHits++; return HttpResponse.json({ error: 'invalid_client' }, { status: 401 }); }),
      http.post('https://api-m.sandbox.paypal.com/v1/oauth2/token', () => { sandboxHits++; return HttpResponse.json({ access_token: 'x', expires_in: 3600 }); })
    );

    await request(app)
      .post('/api/receipts/email-only')
      .set(authHeader)
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id', paypalIsSandbox: true });

    expect(liveHits).toBeGreaterThan(0);
    expect(sandboxHits).toBe(0);
  });

  it('Bidder not found in Bidder-Numbers — returns 400', async () => {
    const response = await request(app)
      .post('/api/receipts/email-only')
      .set(authHeader)
      .send({ bidderId: '999', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Bidder ID 999 not found in the Bidder-Numbers sheet.');
  });

  it('Auth failure', async () => {
    const response = await request(app)
      .post('/api/receipts/email-only')
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id' });
    expect(response.status).toBe(401);
  });

  it("a resend with the same key (a retry after a dropped connection) emails the bidder once (ROADMAP B2)", async () => {
    let sends = 0;
    server.use(http.post("https://gmail.googleapis.com/gmail/v1/users/:userId/messages/send", () => { sends++; return HttpResponse.json({ id: "m" }); }));
    const body = { bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id', idempotencyKey: 'email-42-once' };

    const first = await request(app).post('/api/receipts/email-only').set(authHeader).send(body);
    const resent = await request(app).post('/api/receipts/email-only').set(authHeader).send(body);

    expect([first.status, resent.status]).toEqual([200, 200]);
    expect(resent.body.duplicated).toBe(true);
    expect(sends).toBe(1);
  });

  it("turns away a second email for the same bidder while the first is still sending (a double-click)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    server.use(http.post("https://gmail.googleapis.com/gmail/v1/users/:userId/messages/send", async () => { await gate; return HttpResponse.json({ id: "m" }); }));
    const send = (key: string) => request(app).post('/api/receipts/email-only').set(authHeader)
      .send({ bidderId: '42', spreadsheetId: 'test-spreadsheet-id', itemsSpreadsheetId: 'test-items-spreadsheet-id', idempotencyKey: key });

    const first = send('click-1').then((r) => r);
    await new Promise((r) => setTimeout(r, 200));
    const second = await send('click-2');
    release();
    await first;

    expect(second.status).toBe(409);
  });

  it('Missing bidderId — returns 400 (not a lookup of bidder "undefined")', async () => {
    const response = await request(app).post('/api/receipts/email-only').set(authHeader).send({ spreadsheetId: 'test-spreadsheet-id' });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('bidderId required');
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