import { http, HttpResponse, passthrough } from 'msw'

export let appendCallCount = 0;
export let updateCallCount = 0;
export let lastAppendedRow: any[] = [];
export let appsScriptCallCount = 0;
export let lastAppsScriptParams: any[] = [];
export let lastBulkWritePayload: any[][] = [];
export let bundleWritePayload: any[][] = [];
export let bulkWriteCallCount = 0;
export let productionScriptCallLog: string[] = [];
export let clearedRanges: { spreadsheetId: string; range: string }[] = [];
export let sheetBatchUpdateRequests: { spreadsheetId: string; requests: any[] }[] = [];
export let valuesBatchUpdateRequests: { spreadsheetId: string; data: any[] }[] = [];

export function resetHandlersState() {
  appendCallCount = 0;
  updateCallCount = 0;
  lastAppendedRow = [];
  appsScriptCallCount = 0;
  lastAppsScriptParams = [];
  lastBulkWritePayload = [];
  bundleWritePayload = [];
  bulkWriteCallCount = 0;
  productionScriptCallLog = [];
  clearedRanges = [];
  sheetBatchUpdateRequests = [];
  valuesBatchUpdateRequests = [];
}

export const handlers = [
  // Google OAuth token endpoint
  http.post('https://oauth2.googleapis.com/token', () => {
    return HttpResponse.json({
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      expiry_date: Date.now() + 3600000,
      token_type: "Bearer"
    });
  }),

  // Google Sheets read handler
  http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.includes('Auction-Items')) {
      return HttpResponse.json({
        values: [
          ["Item Number", "Category", "Item Name", "Description", "Value", "Opening Bid", "Min Raise", "Donated By", "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"],
          ["801", "Food", "Pizza Night", "A pizza dinner", "$50.00", "$22.50", "$5.00", "Joe's Pizza", "Certificate", "Active", "", ""],
          ["803", "Food", "Sushi Dinner", "A sushi dinner", "$150.00", "$67.50", "$10.00", "Sushi Place", "Certificate", "Active", "", ""]
        ]
      });
    }
    if (url.pathname.includes('Bidder-Numbers')) {
      const header = ["ID", "First Name", "Last Name", "Email", "Phone", "Checked In", "Checked Out", "Is Paid", "Invoice URL", "Invoice Total Amount", "PayPal Fee Status", "Checkout Timestamp"];
      const dataRow = ["42", "John", "Doe", "john@example.com", "555-0199", "TRUE", "FALSE", "FALSE", "", "", "", ""];
      // A range that starts at row 2 (e.g. "Bidder-Numbers!A2:D", as
      // getBidderLabelList requests) mirrors the real Sheets API and skips
      // the header row - every other range shape (e.g. "A:L", "A1:...")
      // keeps returning header+data, matching every other test's existing
      // expectations of this default handler.
      const decodedRange = decodeURIComponent(url.pathname.split("/").pop() || "");
      const startsAtRowTwo = /![A-Z]+2(?![0-9])/.test(decodedRange);
      return HttpResponse.json({
        values: startsAtRowTwo ? [dataRow] : [header, dataRow]
      });
    }
    if (url.pathname.includes('Categories')) {
      return HttpResponse.json({
        values: [["Category", "Base"], ["Food", "800"], ["Art", "900"]]
      });
    }
    if (url.pathname.includes('Value%20Calculations') || url.pathname.includes('Value Calculations')) {
      return HttpResponse.json({
        values: [
          ["Min Range", "Min Raise"],
          ["0", "5"],
          ["150", "10"],
          ["300", "15"],
          ["450", "20"],
          ["600", "30"],
          ["750", "40"],
          ["900", "50"]
        ]
      });
    }
    return HttpResponse.json({
      values: [["Header1", "Header2"], ["val1", "val2"]]
    });
  }),

  // Google Sheets write handler
  http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', async ({ request }) => {
    updateCallCount++;
    const url = new URL(request.url);
    if (!url.pathname.includes('Bid-Management') && !url.pathname.includes('Bidder-Numbers') && !url.pathname.includes('Follow-Up')) {
      bulkWriteCallCount++;
    }
    
    try {
      const body = await request.clone().json() as any;
      if (body.values && body.values.length > 0) {
        if (!url.pathname.includes('Bid-Management')) {
          lastAppendedRow = body.values[body.values.length - 1];
        }
        lastBulkWritePayload = body.values;
        if (url.pathname.includes('Auction-Items')) {
           bundleWritePayload = body.values;
        }
      }
    } catch(e) {}
    return HttpResponse.json({ updatedRows: 1 });
  }),

  // Google Sheets values.batchUpdate handler (multi-range value writes, e.g. closeAuctionAndCleanup)
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values:batchUpdate', async ({ params, request }) => {
    const body = await request.clone().json().catch(() => ({})) as any;
    valuesBatchUpdateRequests.push({
      spreadsheetId: String(params.spreadsheetId),
      data: body?.data || []
    });
    return HttpResponse.json({ totalUpdatedRows: 1 });
  }),

  // Google Sheets append handler
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range\\:append', async ({ request }) => {
    appendCallCount++;
    try {
      const body = await request.clone().json() as any;
      if (body.values && body.values.length > 0) {
        lastAppendedRow = body.values[0];
      }
    } catch(e) {}
    return HttpResponse.json({ updates: { updatedRows: 1 } });
  }),

  // Google Sheets clear handler
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range\\:clear', ({ params }) => {
    clearedRanges.push({
      spreadsheetId: String(params.spreadsheetId),
      range: decodeURIComponent(String(params.range))
    });
    return HttpResponse.json({ clearedRange: "A1:Z100" });
  }),

  // Google Sheets batchUpdate handler
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId\\:batchUpdate', async ({ params, request }) => {
    const body = await request.clone().json().catch(() => ({})) as any;
    sheetBatchUpdateRequests.push({
      spreadsheetId: String(params.spreadsheetId),
      requests: body?.requests || []
    });
    return HttpResponse.json({ replies: [] });
  }),

  // Google Sheets get spreadsheet metadata handler
  http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId', () => {
    return HttpResponse.json({
      sheets: [
        { properties: { title: "Bidder-Numbers", sheetId: 101 } },
        { properties: { title: "Bid-Management", sheetId: 102 } },
        { properties: { title: "Auction-Status", sheetId: 103 } },
        { properties: { title: "tickets", sheetId: 104 } }
      ]
    });
  }),

  // Gemini API handler
  http.post('https://generativelanguage.googleapis.com/v1beta/models/:model\\:generateContent', () => {
    return HttpResponse.json({
      candidates: [{ content: { parts: [{ text: '["Suggested Bundle Name 1", "Suggested Bundle Name 2"]' }] } }]
    });
  }),

  // Google Drive Files List
  http.get('https://www.googleapis.com/drive/v3/files', () => {
    return HttpResponse.json({
      files: [
        { id: "folder-123", name: "2025 Auction", mimeType: "application/vnd.google-apps.folder" }
      ]
    });
  }),

  // Google Drive Files Create/Copy
  http.post('https://www.googleapis.com/drive/v3/files', () => {
    return HttpResponse.json({ id: "new-file-id", name: "New Item" });
  }),

  http.post('https://www.googleapis.com/drive/v3/files/:fileId/copy', () => {
    return HttpResponse.json({ id: "copied-file-id", name: "Copied Item" });
  }),

  // Google Drive Files Update
  http.patch('https://www.googleapis.com/drive/v3/files/:fileId', () => {
    return HttpResponse.json({ id: "updated-file-id" });
  }),

  // Google Drive Files Get
  http.get('https://www.googleapis.com/drive/v3/files/:fileId', () => {
    return HttpResponse.json({ id: "file-id", name: "Template File" });
  }),

  // Google OAuth userinfo handler
  http.get('https://www.googleapis.com/oauth2/v3/userinfo', () => {
    return HttpResponse.json({
      email: "test@example.com",
      sub: "12345"
    });
  }),

  http.post('https://script.googleapis.com/v1/scripts/:scriptId\\:run', async ({ request }) => {
    appsScriptCallCount++;
    const body = await request.json() as any;
    const funcName = body?.requestBody?.function || body?.function;
    if (funcName) {
      productionScriptCallLog.push(funcName);
    }
    const params = body?.requestBody?.parameters || body?.parameters || [];
    lastAppsScriptParams = params;
    const paymentMethod = params[1];

    if (paymentMethod === 'credit_card') {
      return HttpResponse.json({
        response: {
          result: {
            success: true,
            deferred: true,
            status: "UNPAID",
            bidderId: params[0]
          }
        }
      });
    }

    return HttpResponse.json({
      response: {
        result: {
          success: true,
          deferred: false,
          bidderId: params[0]
        }
      }
    });
  }),

  // Gmail send handler: Intercepts POSTs to the Gmail API so that emailService.ts 
  // can "send" emails successfully without hitting the real network during receipt email tests.
  http.post('https://gmail.googleapis.com/gmail/v1/users/:userId/messages/send', () => {
    return HttpResponse.json({ id: 'mock-message-id', labelIds: ['SENT'] });
  }),

  // Google OAuth v2 userinfo: Intercepts GETs to the v2 userinfo API.
  // Needed because authRoutes.ts's /auth/callback (domain check) and
  // emailService.ts (sender's address) both use the v2 API
  // (google.oauth2({ version: 'v2' }).userinfo.get()), whereas the global
  // app handler above uses v3. Defaults to an @orns.org email;
  // auth.test.ts overrides this per-test to exercise the rejection path.
  http.get('https://www.googleapis.com/oauth2/v2/userinfo', () => {
    return HttpResponse.json({ email: 'test@orns.org', name: 'Test User' });
  }),

  // PayPal sandbox handlers - default success responses so any test that
  // exercises server/services/paypalService.ts through
  // receiptDataService.ts's resolveInvoiceUrl (without overriding these)
  // gets a deterministic, harmless mock instead of ever reaching real
  // PayPal, sandbox or otherwise (setup.ts throws on any unmocked
  // external request, including api-m.paypal.com - the production host
  // is deliberately left unmocked so a test that accidentally resolves
  // to production fails loudly instead of silently "succeeding").
  http.post('https://api-m.sandbox.paypal.com/v1/oauth2/token', () => {
    return HttpResponse.json({ access_token: 'mock-paypal-sandbox-token' });
  }),
  http.post('https://api-m.sandbox.paypal.com/v2/invoicing/invoices', () => {
    return HttpResponse.json({ id: 'INV2-MOCK-0000-0000-0001' }, { status: 201 });
  }),
  http.post('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/:invoiceId/send', ({ params }) => {
    return HttpResponse.json({
      links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/invoice/p/#${params.invoiceId}` }],
    });
  }),
  http.post('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/:invoiceId/cancel', () => {
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('https://api-m.sandbox.paypal.com/v2/invoicing/invoices/:invoiceId', () => {
    return HttpResponse.json({ status: 'SENT' });
  })
]
