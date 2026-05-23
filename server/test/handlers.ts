import { http, HttpResponse, passthrough } from 'msw'

export let appendCallCount = 0;
export let updateCallCount = 0;
export let lastAppendedRow: any[] = [];
export function resetHandlersState() {
  appendCallCount = 0;
  updateCallCount = 0;
  lastAppendedRow = [];
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
    try {
      const body = await request.clone().json() as any;
      if (body.values && body.values.length > 0) {
        lastAppendedRow = body.values[body.values.length - 1];
      }
    } catch(e) {}
    return HttpResponse.json({ updatedRows: 1 });
  }),

  // Google Sheets batch update handler
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values:batchUpdate', () => {
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
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range\\:clear', () => {
    return HttpResponse.json({ clearedRange: "A1:Z100" });
  }),

  // Google Sheets batchUpdate handler
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId\\:batchUpdate', () => {
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

  http.post('https://script.googleapis.com/v1/scripts/:scriptId\\:run', ({ request }) => {
    console.log('MSW Intercepted:', request.url);
    return HttpResponse.json({
      response: { 
        result: { 
          success: true, 
          message: "MSW intercepted this!" 
        } 
      }
    })
  })
]
