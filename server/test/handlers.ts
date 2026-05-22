import { http, HttpResponse, passthrough } from 'msw'

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
  http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
    return HttpResponse.json({
      values: [["Header1", "Header2"], ["val1", "val2"]]
    });
  }),

  // Google Sheets write handler
  http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
    return HttpResponse.json({ updatedRows: 1 });
  }),

  // Google Sheets batch update handler
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values:batchUpdate', () => {
    return HttpResponse.json({ totalUpdatedRows: 1 });
  }),

  // Google Sheets append handler
  http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range\\:append', () => {
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
