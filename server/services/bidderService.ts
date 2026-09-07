import { sheets_v4 } from "googleapis";
import { getColumnLetter } from "../utils/columnUtils";
import { executeGoogleSheetsTransaction, SheetOp } from "../services/sheetsService";
import { withLock } from "../utils/asyncLock";
import { AUCTION_TICKETS_ITEM_ID } from "../utils/categoryHelpers";

export interface WalkInParams {
  firstName: string;
  lastName: string;
  email?: string;
  spreadsheetId: string;
  ticketsSpreadsheetId?: string;
  ticketPrice?: number;
  bidderNumbersSheet: string;
  bidManagementSheet: string;
}

export interface BidderResult {
  success: boolean;
  bidder: {
    id: number;
    firstName: string;
    lastName: string;
    email?: string;
  };
  ticketAppended: boolean;
  appendError: string | null;
}

export interface CheckInParams {
  bidderId: string;
  spreadsheetId: string;
  bidManagementSheet: string;
  bidderNumbersSheet: string;
  bidValue: number;
}

export interface CheckInResult {
  success: boolean;
  bidAdded: boolean;
  checkedIn: boolean;
}

/**
 * Registers a new walk-in bidder across multiple spreadsheets.
 * Logic extracted from legacy bidRoutes.ts
 *
 * Wrapped in withLock, keyed per Bid-Management spreadsheet: this function
 * computes the next bidder ID and the next open Bid-Management column pair
 * from a fresh read, then writes to them - two walk-ins registered within
 * the same read/write window (a real risk once more than one person works
 * the door) would otherwise be able to compute the same ID/columns, and
 * the second write would silently clobber the first's data. See
 * docs/agents/ROADMAP.md's "Concurrency Safety for Simultaneous Bidder
 * Operations" milestone.
 */
export async function registerWalkInBidder(
  sheets: sheets_v4.Sheets,
  params: WalkInParams
): Promise<BidderResult> {
  return withLock(`bidder-numbers:${params.spreadsheetId}`, () => registerWalkInBidderLocked(sheets, params));
}

async function registerWalkInBidderLocked(
  sheets: sheets_v4.Sheets,
  params: WalkInParams
): Promise<BidderResult> {
  const {
    firstName,
    lastName,
    email,
    spreadsheetId,
    ticketsSpreadsheetId,
    ticketPrice,
    bidderNumbersSheet,
    bidManagementSheet
  } = params;

  // Step 0: Pre-verify Tickets Sheet if provided
  let targetTicketSheetName = "tickets";
  if (ticketsSpreadsheetId) {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: ticketsSpreadsheetId });
    const sheet = spreadsheet.data.sheets?.find(s => 
      s.properties?.title?.toLowerCase() === "tickets"
    );
    targetTicketSheetName = sheet?.properties?.title || "tickets";
    
    // Verify access
    await sheets.spreadsheets.values.get({
      spreadsheetId: ticketsSpreadsheetId,
      range: `'${targetTicketSheetName}'!A1`, 
    });
  }

  // Step A: Fetch Sheet Metadata
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const bdSheet = metadata.data.sheets?.find(s => s.properties?.title === bidderNumbersSheet);
  const bmSheet = metadata.data.sheets?.find(s => s.properties?.title === bidManagementSheet);
  
  if (!bdSheet || !bmSheet) {
    throw new Error("[Walk-In] Could not find required sheets. Please verify settings.");
  }

  // Step B: Calculate new Bidder ID
  const bdData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${bidderNumbersSheet}'!A:A`
  });
  const bdRows = bdData.data.values || [];
  
  const formatName = (str: string) => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
  const formattedFirst = formatName(firstName);
  const formattedLast = formatName(lastName);
  const formattedEmail = (email || "").trim();

  const maxId = bdRows.slice(1).reduce((max: number, row: any) => Math.max(max, parseInt(row[0]) || 0), 100);
  const newId = maxId + 1;

  // Step C: Prepare Bid-Management columns
  const bmData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${bidManagementSheet}'!1:5`
  });
  
  let maxCols = 0;
  (bmData.data.values || []).forEach((row: any[]) => {
    maxCols = Math.max(maxCols, row.length);
  });
  
  let lastColIndex = maxCols;
  if (lastColIndex % 2 !== 0) lastColIndex += 1;
  
  const totalCols = bmSheet.properties?.gridProperties?.columnCount || 0;
  if (totalCols <= lastColIndex + 2) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            appendDimension: {
              sheetId: bmSheet.properties?.sheetId,
              dimension: "COLUMNS",
              length: Math.max(2, (lastColIndex + 2) - totalCols + 2)
            }
          }
        ]
      }
    });
  }

  // Step D: Define Transactions
  const newColLetter = getColumnLetter(lastColIndex);
  const nextColLetter = getColumnLetter(lastColIndex + 1);
  
  const operations: SheetOp[] = [
    {
      type: 'APPEND',
      spreadsheetId,
      range: `${bidderNumbersSheet}!A:H`,
      newValues: [[newId, formattedFirst, formattedLast, formattedEmail, true, false, false, false]]
    },
    {
      type: 'UPDATE',
      spreadsheetId,
      range: `${bidManagementSheet}!${newColLetter}1:${nextColLetter}4`,
      newValues: [
        [newId, ""],
        [formattedFirst, formattedLast],
        ['Item #:', 'Price:'],
        [AUCTION_TICKETS_ITEM_ID, ticketPrice || 35]
      ]
    }
  ];

  await executeGoogleSheetsTransaction(sheets, operations);

  // Step E: Rich Formatting for Bid-Management
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          mergeCells: {
            range: {
              sheetId: bmSheet.properties?.sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: lastColIndex,
              endColumnIndex: lastColIndex + 2
            },
            mergeType: "MERGE_ALL"
          }
        },
        {
          repeatCell: {
            range: {
              sheetId: bmSheet.properties?.sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: lastColIndex,
              endColumnIndex: lastColIndex + 2
            },
            cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
            fields: "userEnteredFormat.horizontalAlignment"
          }
        },
        {
          repeatCell: {
            range: {
              sheetId: bmSheet.properties?.sheetId,
              startRowIndex: 1,
              endRowIndex: 2,
              startColumnIndex: lastColIndex,
              endColumnIndex: lastColIndex + 2
            },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold"
          }
        }
      ]
    }
  });

  // Step F: Write to Tickets Spreadsheet if provided
  let ticketAppended = false;
  let appendError = null;
  if (ticketsSpreadsheetId) {
    try {
      const rowValue = new Array(22).fill("");
      rowValue[0] = firstName;
      rowValue[1] = lastName;
      rowValue[2] = email || "";
      rowValue[4] = "1";
      rowValue[5] = "FALSE";
      rowValue[19] = "Auction Checkout"; 
      rowValue[20] = "Pending";
      rowValue[21] = `$${ticketPrice || 35}`; 
      
      await executeGoogleSheetsTransaction(sheets, [{
        type: 'APPEND',
        spreadsheetId: ticketsSpreadsheetId,
        range: `${targetTicketSheetName}!A:V`,
        newValues: [rowValue]
      }]);
      ticketAppended = true;
    } catch (err: any) {
      appendError = err.message;
    }
  }

  return {
    success: true,
    bidder: { id: newId, firstName: formattedFirst, lastName: formattedLast, email: formattedEmail },
    ticketAppended,
    appendError
  };
}

/**
 * Checks in a bidder and optionally adds a check-in bid (e.g. for ticket payment).
 *
 * Wrapped in withLock, keyed per Bid-Management spreadsheet - the exact
 * same "scan the bidder's own column for the first empty row from a
 * fresh read, then write to it" pattern `recordWinningBid` (see
 * auctionService.ts) is wrapped for, and for the same reason: two staff
 * checking in the same bidder's initial ticket-payment bid within the
 * same read/write window could otherwise compute the same "first empty
 * row" and the second write would silently clobber the first. Found in
 * a hardening audit - see docs/agents/refactor-opportunities.md's Code
 * Hardening item #1 / CHANGELOG.md.
 */
export async function checkInBidderWithBid(
  sheets: sheets_v4.Sheets,
  params: CheckInParams
): Promise<CheckInResult> {
  return withLock(`bidder-numbers:${params.spreadsheetId}`, () => checkInBidderWithBidLocked(sheets, params));
}

async function checkInBidderWithBidLocked(
  sheets: sheets_v4.Sheets,
  params: CheckInParams
): Promise<CheckInResult> {
  const {
    bidderId,
    spreadsheetId,
    bidManagementSheet,
    bidderNumbersSheet,
    bidValue
  } = params;

  // 1. Find Bidder Column in Bid-Management
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
  if (colIndex === -1) throw new Error("Bidder column not found in Bid Management");

  // 2. Find Empty Row for this Bidder
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

  // 3. Find Bidder Row in Bidder Numbers to mark checked-in
  const bidderSearch = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${bidderNumbersSheet}'!A:A`,
  });
  const biddersRows = bidderSearch.data.values || [];
  const bidderRowIndex = biddersRows.findIndex((row: any) => row[0]?.toString() === bidderId) + 1;

  const operations: SheetOp[] = [
    {
      type: 'UPDATE',
      spreadsheetId,
      range: `'${bidManagementSheet}'!${colLetter}${rowIndex}:${nextColLetter}${rowIndex}`,
      newValues: [[AUCTION_TICKETS_ITEM_ID, bidValue]]
    }
  ];

  if (bidderRowIndex > 1) {
    operations.push({
      type: 'UPDATE',
      spreadsheetId,
      range: `'${bidderNumbersSheet}'!E${bidderRowIndex}`,
      newValues: [[true]]
    });
  }

  await executeGoogleSheetsTransaction(sheets, operations);

  return { success: true, bidAdded: true, checkedIn: true };
}

export interface UpdateAttendeeParams {
  spreadsheetId: string;
  sheet: string;
  rowIndex: number;
  field: string;
  value: string;
}

export async function updateAttendeeField(
  sheets: sheets_v4.Sheets,
  params: UpdateAttendeeParams
): Promise<{ success: boolean }> {
  const { spreadsheetId, sheet, rowIndex, field, value } = params;

  if (!rowIndex || isNaN(Number(rowIndex)) || Number(rowIndex) < 1) {
    const error: any = new Error("Row index must be a positive number.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedSheet = sheet.trim().toLowerCase();

  const fieldMapping: Record<string, string> = {
    firstName: "A",
    lastName: "B",
    email: "C",
    phone: "D",
    paymentStatus: normalizedSheet === "tickets" ? "U" : "R"
  };

  const colLetter = fieldMapping[field];
  if (!colLetter) {
    const error: any = new Error(`Invalid field: ${field}`);
    error.statusCode = 400;
    throw error;
  }

  const range = `'${sheet}'!${colLetter}${rowIndex}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[value]]
    }
  });

  return { success: true };
}
