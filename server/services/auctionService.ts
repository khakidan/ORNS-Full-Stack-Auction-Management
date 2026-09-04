import { google, sheets_v4 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getColumnLetter } from "../utils/columnUtils";
import { executeGoogleSheetsTransaction, SheetOp } from "../services/sheetsService";
import { withLock } from "../utils/asyncLock";

export interface RecordWinningBidParams {
  bidderId: string;
  itemId: string;
  price: number;
  spreadsheetId: string;
  bidManagementSheet: string;
  bidderNumbersSheet: string;
}

export interface WinningBidResult {
  success: boolean;
  followUpAdded: boolean;
}

export interface CheckoutParams {
  bidderId: string;
  spreadsheetId: string;
  ticketsSpreadsheetId?: string;
  bidderNumbersSheet: string;
  paymentMethod: string;
  attendeeInfo?: {
    sheet: string;
    rowIndex: number;
  };
}

export interface CheckoutResult {
  success: boolean;
  attendeeUpdated: boolean;
  deferred?: boolean;
}

export interface CloseAuctionParams {
  spreadsheetId: string;
  bidderNumbersSheet: string;
  bidManagementSheet: string;
}

export interface CloseAuctionResult {
  success: boolean;
  count: number;
}

/**
 * Records a winning bid for a bidder.
 * If the bidder has already checked out, it also records the bid in a "Follow-Up" sheet.
 *
 * Wrapped in withLock, keyed per Bid-Management spreadsheet: this function
 * finds the winning bidder's own column (safe, identity-based), then scans
 * down that column for the first empty row from a fresh read, then writes
 * to it. If the same bidder wins two items and two different staff record
 * them within the same read/write window - a normal, good outcome at a
 * live auction, not an edge case - both computations can land on the same
 * "first empty row," and the second recorded win silently overwrites the
 * first: a lost winning-bid record, meaning a sold item never gets
 * invoiced. See docs/agents/ROADMAP.md's "Concurrency Safety for
 * Simultaneous Bidder Operations" milestone.
 */
export async function recordWinningBid(
  sheets: sheets_v4.Sheets,
  params: RecordWinningBidParams
): Promise<WinningBidResult> {
  return withLock(`bidder-numbers:${params.spreadsheetId}`, () => recordWinningBidLocked(sheets, params));
}

async function recordWinningBidLocked(
  sheets: sheets_v4.Sheets,
  params: RecordWinningBidParams
): Promise<WinningBidResult> {
  const {
    bidderId,
    itemId,
    price,
    spreadsheetId,
    bidManagementSheet,
    bidderNumbersSheet
  } = params;

  // 1. Get Bidder Info to check checkout status
  const bidderSearch = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${bidderNumbersSheet}'!A:G`,
  });
  const biddersRows = bidderSearch.data.values || [];
  const bidderRow = biddersRows.find((row: any) => row[0]?.toString() === bidderId);
  
  if (!bidderRow) {
    throw new Error(`Bidder ${bidderId} not found.`);
  }

  const isCheckedOut = bidderRow[6] === true || bidderRow[6] === "TRUE";

  // 2. Find Bidder Column in Bid-Management
  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${bidManagementSheet}'!1:300`,
  });
  const values = dataRes.data.values || [];
  if (values.length === 0) throw new Error("Bid sheet is empty");

  const header = values[0];
  let colIndex = -1;
  for (let j = 0; j < header.length; j += 2) {
    if (header[j]?.toString() === bidderId) {
      colIndex = j;
      break;
    }
  }
  if (colIndex === -1) throw new Error("Bidder column not found in Bid Management sheet");

  // 3. Find Empty Row for Bid
  let rowIndex = -1;
  for (let i = 3; i < values.length; i++) {
    if (!values[i] || !values[i][colIndex]) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) rowIndex = values.length + 1;
  if (rowIndex < 4) rowIndex = 4;

  const colLetter = getColumnLetter(colIndex);
  const nextColLetter = getColumnLetter(colIndex + 1);

  const operations: SheetOp[] = [
    {
      type: 'UPDATE',
      spreadsheetId,
      range: `${bidManagementSheet}!${colLetter}${rowIndex}:${nextColLetter}${rowIndex}`,
      newValues: [[itemId, price]]
    }
  ];

  let followUpAdded = false;
  if (isCheckedOut) {
    // 4. Handle Follow-Up for already checked out bidders
    const metadata = await sheets.spreadsheets.get({ spreadsheetId });
    const followUpSheet = metadata.data.sheets?.find(s => s.properties?.title === "Follow-Up");
    
    if (!followUpSheet) {
      // Create Follow-Up sheet if it doesn't exist
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: "Follow-Up" }
            }
          }]
        }
      });
      // Add header
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Follow-Up!A1:C1",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["Bidder ID", "Item ID", "Amount"]]
        }
      });
    }

    operations.push({
      type: 'APPEND',
      spreadsheetId,
      range: `Follow-Up!A:C`,
      newValues: [[bidderId, itemId, price]]
    });
    followUpAdded = true;
  }

  await executeGoogleSheetsTransaction(sheets, operations);

  return { success: true, followUpAdded };
}

/**
 * Marks a bidder as paid across spreadsheets and executes their checkout.
 * Relies on Apps Script bridge for core payment logic.
 *
 * Wrapped in withLock, keyed per Bid-Management spreadsheet, as
 * defense-in-depth alongside recordWinningBid/registerWalkInBidder above,
 * even though this path is already safe on its own (Class_GoogleAIStudio.gs's
 * recordPayment finds its target row by scanning for the bidder's own ID -
 * not a computed "next open slot" - and every payment-method branch writes
 * a specific final value, not an incrementally-computed one, so concurrent
 * calls are naturally idempotent). Keeps every bidder-mutating write path
 * in this app protected by the same rule, and the lock is held across the
 * full Apps Script bridge round-trip (script.scripts.run), which also
 * fully serializes the underlying .gs execution - no LockService needed
 * on that side. See docs/agents/ROADMAP.md's "Concurrency Safety for
 * Simultaneous Bidder Operations" milestone.
 */
export async function checkoutMarkPaid(
  auth: OAuth2Client,
  params: CheckoutParams
): Promise<CheckoutResult> {
  return withLock(`bidder-numbers:${params.spreadsheetId}`, () => checkoutMarkPaidLocked(auth, params));
}

async function checkoutMarkPaidLocked(
  auth: OAuth2Client,
  params: CheckoutParams
): Promise<CheckoutResult> {
  const {
    bidderId,
    spreadsheetId,
    ticketsSpreadsheetId,
    bidderNumbersSheet,
    paymentMethod,
    attendeeInfo
  } = params;

  const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;
  if (!scriptId) {
    throw new Error("SCRIPT_ID_BID_MANAGEMENT is not configured.");
  }

  // 1. Call Apps Script bridge function apiRecordPayment
  const script = google.script({ version: "v1", auth });
  
  const scriptResponse = await script.scripts.run({
    scriptId: scriptId,
    requestBody: {
      function: "apiRecordPayment",
      parameters: [String(bidderId), paymentMethod || "cash"],
      devMode: true,
    },
  });
  
  if (scriptResponse.data.error) {
    const eData = scriptResponse.data.error.details?.[0] as any;
    throw new Error(eData?.errorMessage || "Unknown Apps Script execution error");
  }

  const { response } = scriptResponse.data;
  let deferred = false;
  if (response?.result && typeof response.result === 'object') {
    const resultObj = response.result as any;
    if (resultObj.success === false) {
      throw new Error(resultObj.error || "Failed to record payment in Google Apps Script");
    }
    if (resultObj.deferred === true) {
      deferred = true;
    }
  }

  // 2. Optional: Update Tickets Spreadsheet
  let attendeeUpdated = false;
  if (ticketsSpreadsheetId && attendeeInfo?.sheet && attendeeInfo.rowIndex) {
    const sheets = google.sheets({ version: "v4", auth });
    const operations: SheetOp[] = [
      {
        type: 'UPDATE',
        spreadsheetId: ticketsSpreadsheetId,
        range: `${attendeeInfo.sheet}!U${attendeeInfo.rowIndex}`,
        newValues: [["Paid"]]
      }
    ];
    await executeGoogleSheetsTransaction(sheets, operations);
    attendeeUpdated = true;
  }

  return { success: true, attendeeUpdated, deferred };
}

/**
 * Closes the auction and marks bidders who didn't win anything as ready for checkout.
 */
export async function closeAuctionAndCleanup(
  sheets: sheets_v4.Sheets,
  params: CloseAuctionParams
): Promise<CloseAuctionResult> {
  const { spreadsheetId, bidderNumbersSheet, bidManagementSheet } = params;

  // 1. Close Auction Status
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Auction-Status'!A2",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[false]] }
  });

  // 2. Determine Winners
  const biddersRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${bidderNumbersSheet}'!A:H`
  });
  const bidderRows = biddersRes.data.values || [];

  const bidRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${bidManagementSheet}'!A:ZZ`
  });
  const bidRows = bidRes.data.values || [];
  
  const winnersSet = new Set<string>();
  if (bidRows.length > 0) {
    const header = bidRows[0];
    for (let j = 0; j < header.length; j += 2) {
      const bidderId = header[j];
      if (!bidderId) continue;
      
      let hasWins = false;
      for (let i = 3; i < bidRows.length; i++) {
        if (bidRows[i] && bidRows[i][j]) {
          hasWins = true;
          break;
        }
      }
      if (hasWins) winnersSet.add(bidderId.toString());
    }
  }

  // 3. Queue Updates for Non-Winners
  const updates: any[] = [];
  for (let i = 1; i < bidderRows.length; i++) {
    const id = bidderRows[i][0]?.toString();
    const checkedIn = bidderRows[i][4] === "TRUE" || bidderRows[i][4] === "true";
    const checkedOut = bidderRows[i][6] === "TRUE" || bidderRows[i][6] === "true";
    
    if (id && checkedIn && !checkedOut && !winnersSet.has(id)) {
      updates.push({
        range: `'${bidderNumbersSheet}'!G${i + 1}:H${i + 1}`,
        values: [[true, true]] 
      });
    }
  }

  // 4. Batch Update Bidders
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: updates,
        valueInputOption: "USER_ENTERED"
      }
    });
  }

  return { success: true, count: updates.length };
}
