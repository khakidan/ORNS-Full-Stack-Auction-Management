import { sheets_v4 } from "googleapis";
import { getColumnLetter } from "../utils/columnUtils";
import { executeGoogleSheetsTransaction, SheetOp } from "../services/sheetsService";
import { withLock } from "../utils/asyncLock";
import { AUCTION_TICKETS_ITEM_ID } from "../utils/categoryHelpers";
import { BIDDER_COL, TICKETS_COL, WALK_IN_PAYMENT_METHOD } from "../utils/sheetColumns";
import { findBidderColumn, findBidderRowIndex, firstEmptyBidRow } from "../utils/bidGrid";
import { bidderEmail, bidderName } from "./ticketPeople";

export interface WalkInParams {
  firstName: string;
  lastName: string;
  email?: string;
  spreadsheetId: string;
  ticketsSpreadsheetId?: string;
  /** As text from the Config ("35", "37.50") - kept as typed so "$37.50" keeps its cents - or a number. */
  ticketPrice?: string | number;
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

const DEFAULT_TICKET_PRICE = 35;


/** One more than the highest bidder number in Bidder-Numbers column A (walk-ins start above 100). */
export function nextBidderId(idRows: unknown[][]): number {
  return idRows.slice(1).reduce<number>((max, row) => Math.max(max, parseInt(String(row?.[BIDDER_COL.id] ?? "")) || 0), 100) + 1;
}

/** The 0-based column where a new bidder's item/price pair starts: the first even column after everything in the grid's top rows. */
export function nextColumnPairStart(gridTopRows: unknown[][]): number {
  const used = gridTopRows.reduce<number>((max, row) => Math.max(max, row.length), 0);
  return used % 2 === 0 ? used : used + 1;
}

/** A walk-in's rows 1-4 in their Bid-Management column pair: ID, name, captions, and their ticket as the first "bid". */
export function walkInGridValues(id: number, first: string, last: string, ticketPrice: string | number): (string | number)[][] {
  return [
    [id, ""],
    [first, last],
    ['Item #:', 'Price:'],
    [AUCTION_TICKETS_ITEM_ID, ticketPrice]
  ];
}

/** Merges and centres a bidder's ID cell across their two grid columns and bolds their name row (walk-ins, and bidders added from new tickets). */
export function bidderColumnFormatRequests(sheetId: number | null | undefined, startCol: number): sheets_v4.Schema$Request[] {
  const columns = { sheetId, startColumnIndex: startCol, endColumnIndex: startCol + 2 };
  return [
    { mergeCells: { range: { ...columns, startRowIndex: 0, endRowIndex: 1 }, mergeType: "MERGE_ALL" } },
    {
      repeatCell: {
        range: { ...columns, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat.horizontalAlignment"
      }
    },
    {
      repeatCell: {
        range: { ...columns, startRowIndex: 1, endRowIndex: 2 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold"
      }
    }
  ];
}

/** The walk-in's row for the 'tickets' tab (A-V): one ticket, no guests, paid at checkout. */
export function walkInTicketRow(firstName: string, lastName: string, email: string, ticketPrice: string | number): string[] {
  const row = new Array(TICKETS_COL.totalPaid + 1).fill("");
  row[TICKETS_COL.firstName] = firstName;
  row[TICKETS_COL.lastName] = lastName;
  row[TICKETS_COL.email] = email;
  row[TICKETS_COL.ticketsPurchased] = "1";
  row[TICKETS_COL.hasGuests] = "FALSE";
  row[TICKETS_COL.paymentMethod] = WALK_IN_PAYMENT_METHOD;
  row[TICKETS_COL.paymentStatus] = "Pending";
  row[TICKETS_COL.totalPaid] = `$${ticketPrice}`;
  return row;
}

/** The tickets spreadsheet's 'tickets' tab name as typed (matched ignoring case), after checking it can be read. */
async function findTicketsTab(sheets: sheets_v4.Sheets, ticketsSpreadsheetId: string): Promise<string> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: ticketsSpreadsheetId });
  const tab = spreadsheet.data.sheets?.find(s => s.properties?.title?.toLowerCase() === "tickets");
  const title = tab?.properties?.title || "tickets";
  await sheets.spreadsheets.values.get({ spreadsheetId: ticketsSpreadsheetId, range: `'${title}'!A1` });
  return title;
}

async function registerWalkInBidderLocked(
  sheets: sheets_v4.Sheets,
  params: WalkInParams
): Promise<BidderResult> {
  const { firstName, lastName, email, spreadsheetId, ticketsSpreadsheetId, bidderNumbersSheet, bidManagementSheet } = params;
  const ticketPrice = params.ticketPrice || DEFAULT_TICKET_PRICE;

  // 1. Check the tickets spreadsheet can be read before changing anything.
  const ticketsTab = ticketsSpreadsheetId ? await findTicketsTab(sheets, ticketsSpreadsheetId) : "tickets";

  // 2. Both Bid-Management tabs must exist.
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const bdSheet = metadata.data.sheets?.find(s => s.properties?.title === bidderNumbersSheet);
  const bmSheet = metadata.data.sheets?.find(s => s.properties?.title === bidManagementSheet);
  if (!bdSheet || !bmSheet) {
    throw new Error("[Walk-In] Could not find required sheets. Please verify settings.");
  }

  // 3. The new bidder number, and their column pair (growing the grid if it's too narrow).
  const idRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidderNumbersSheet}'!A:A` });
  const newId = nextBidderId(idRes.data.values || []);
  const formattedFirst = bidderName(firstName);
  const formattedLast = bidderName(lastName);
  const formattedEmail = bidderEmail(email);

  const gridRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidManagementSheet}'!1:5` });
  const startCol = nextColumnPairStart(gridRes.data.values || []);
  const gridWidth = bmSheet.properties?.gridProperties?.columnCount || 0;
  if (gridWidth <= startCol + 2) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          appendDimension: { sheetId: bmSheet.properties?.sheetId, dimension: "COLUMNS", length: Math.max(2, (startCol + 2) - gridWidth + 2) }
        }]
      }
    });
  }

  // 4. Add them to Bidder-Numbers (checked in) and the grid, together.
  await executeGoogleSheetsTransaction(sheets, [
    {
      type: 'APPEND',
      spreadsheetId,
      range: `${bidderNumbersSheet}!A:H`,
      newValues: [[newId, formattedFirst, formattedLast, formattedEmail, true, false, false, false]]
    },
    {
      type: 'UPDATE',
      spreadsheetId,
      range: `${bidManagementSheet}!${getColumnLetter(startCol)}1:${getColumnLetter(startCol + 1)}4`,
      newValues: walkInGridValues(newId, formattedFirst, formattedLast, ticketPrice)
    }
  ]);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: bidderColumnFormatRequests(bmSheet.properties?.sheetId, startCol) }
  });

  // 5. Add their ticket to the tickets spreadsheet. A failure here doesn't
  // undo the registration; it's reported back as appendError.
  let ticketAppended = false;
  let appendError = null;
  if (ticketsSpreadsheetId) {
    try {
      await executeGoogleSheetsTransaction(sheets, [{
        type: 'APPEND',
        spreadsheetId: ticketsSpreadsheetId,
        range: `${ticketsTab}!A:V`,
        newValues: [walkInTicketRow(firstName, lastName, email || "", ticketPrice)]
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
 * a hardening audit - see docs/agents/CHANGELOG.md's Code
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

  // 1. The bidder's column pair in the Bid-Management grid, and its first empty bid row.
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidManagementSheet}'!1:300` });
  const values = dataRes.data.values || [];
  if (values.length === 0) throw new Error("Bid sheet is empty");
  const colIndex = findBidderColumn(values, bidderId);
  if (colIndex === -1) throw new Error("Bidder column not found in Bid Management");
  const rowIndex = firstEmptyBidRow(values, colIndex);
  const colLetter = getColumnLetter(colIndex);
  const nextColLetter = getColumnLetter(colIndex + 1);

  // 2. The bidder's Bidder-Numbers row. A bidder missing here fails the
  // whole check-in before anything is written (ROADMAP.md L4) - it used to
  // add the ticket bid anyway and report `checkedIn: true` without checking
  // anyone in.
  const bidderSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidderNumbersSheet}'!A:A` });
  const bidderRowIndex = findBidderRowIndex(bidderSearch.data.values || [], bidderId) + 1;
  if (bidderRowIndex < 2) throw new Error(`Bidder ${bidderId} not found in ${bidderNumbersSheet}`);

  const operations: SheetOp[] = [
    {
      type: 'UPDATE',
      spreadsheetId,
      range: `'${bidManagementSheet}'!${colLetter}${rowIndex}:${nextColLetter}${rowIndex}`,
      newValues: [[AUCTION_TICKETS_ITEM_ID, bidValue]]
    },
    {
      type: 'UPDATE',
      spreadsheetId,
      range: `'${bidderNumbersSheet}'!${BIDDER_FLAG_COLUMNS.checkedIn}${bidderRowIndex}`,
      newValues: [[true]]
    }
  ];

  await executeGoogleSheetsTransaction(sheets, operations);

  return { success: true, bidAdded: true, checkedIn: true };
}

/** Bidder-Numbers checkbox columns the Bidders page can tick (schema.md). */
export const BIDDER_FLAG_COLUMNS = { checkedIn: "E", isProxy: "F" } as const;
export type BidderFlag = keyof typeof BIDDER_FLAG_COLUMNS;

export interface SetBidderFlagParams {
  spreadsheetId: string;
  bidderNumbersSheet: string;
  bidderId: string;
  flag: BidderFlag;
}

/**
 * Ticks a bidder's Checked In (E) or Proxy Bidder (F) box.
 *
 * Wrapped in the same `bidder-numbers:` lock as every other Bidder-Numbers
 * writer (patterns.md), so the row lookup and the write can't interleave
 * with a walk-in registration or checkout on the same sheet.
 */
/** `range` is the cell ticked and `before` its old value, for Action History. */
export async function setBidderFlag(sheets: sheets_v4.Sheets, params: SetBidderFlagParams): Promise<{ success: boolean; range: string; before: boolean }> {
  return withLock(`bidder-numbers:${params.spreadsheetId}`, async () => {
    const { spreadsheetId, bidderNumbersSheet, bidderId, flag } = params;
    const search = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidderNumbersSheet}'!A:F` });
    const rows = search.data.values || [];
    const rowIndex = findBidderRowIndex(rows, bidderId) + 1;
    if (rowIndex < 2) throw new Error(`Bidder ${bidderId} not found in ${bidderNumbersSheet}`);
    const oldCell = rows[rowIndex - 1]?.[BIDDER_FLAG_COLUMNS[flag].charCodeAt(0) - 65];
    const range = `'${bidderNumbersSheet}'!${BIDDER_FLAG_COLUMNS[flag]}${rowIndex}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[true]] },
    });
    return { success: true, range, before: oldCell === true || String(oldCell ?? "").toUpperCase() === "TRUE" };
  });
}
