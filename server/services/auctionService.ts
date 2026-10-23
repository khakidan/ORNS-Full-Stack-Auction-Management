import { google, sheets_v4 } from "googleapis";
import { IDEMPOTENT_POST_RETRY } from "../utils/googleRetry";
import { OAuth2Client } from "google-auth-library";
import { getColumnLetter } from "../utils/columnUtils";
import { executeGoogleSheetsTransaction, SheetOp, ensureSheetTab, FOLLOW_UP_HEADER } from "../services/sheetsService";
import { withLock } from "../utils/asyncLock";
import { ensureTrackingHeaders } from "../utils/bidderNumbersHeaders";
import { PayPalService, isPaidInvoiceStatus } from "./paypalService";
import { buildBidderReceiptWithInvoice, DEFAULT_SHEET_NAMES } from "./receiptDataService";
import { findExistingWins, isRepeatableItem, WinningBidConflictError } from "../utils/winningBidChecks";
import { BIDDER_COL, TICKETS_COL } from "../utils/sheetColumns";
import { findBidderColumn, findBidderRowIndex, firstEmptyBidRow } from "../utils/bidGrid";

export interface RecordWinningBidParams {
  bidderId: string;
  itemId: string;
  price: number;
  spreadsheetId: string;
  bidManagementSheet: string;
  bidderNumbersSheet: string;
  /**
   * The Items spreadsheet, for the one-winner check (Milestone A). Without
   * it the check is skipped, as it was before - older clients don't send it.
   */
  itemsSpreadsheetId?: string;
}

export interface WinningBidResult {
  success: boolean;
  followUpAdded: boolean;
  /** This exact bid (same bidder, same price) was already in the sheet, so nothing was written. */
  alreadyRecorded?: boolean;
}

export interface CheckoutParams {
  bidderId: string;
  spreadsheetId: string;
  itemsSpreadsheetId?: string;
  ticketsSpreadsheetId?: string;
  bidderNumbersSheet: string;
  /** Only needed when checkout has to create the bidder's invoice; defaults to "Bid-Management". */
  bidManagementSheet?: string;
  paymentMethod: string;
  paypalIsSandbox?: boolean;
  attendeeInfo?: {
    sheet: string;
    rowIndex: number;
  };
}

export interface CheckoutResult {
  success: boolean;
  attendeeUpdated: boolean;
  deferred?: boolean;
  /** Set when the payment was recorded but staff still need to act - shown to them as a warning. */
  warning?: string;
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
  const { bidderId, itemId, price, spreadsheetId, bidManagementSheet, bidderNumbersSheet, itemsSpreadsheetId } = params;

  // 1. The bidder must exist; a bidder who already checked out also gets a Follow-Up row.
  const bidderSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidderNumbersSheet}'!A:G` });
  const bidderRows = bidderSearch.data.values || [];
  const bidderRowIndex = findBidderRowIndex(bidderRows, bidderId);
  if (bidderRowIndex === -1) {
    throw new Error(`Bidder ${bidderId} not found.`);
  }
  const checkedOutCell = bidderRows[bidderRowIndex][BIDDER_COL.checkedOut];
  const isCheckedOut = checkedOutCell === true || checkedOutCell === "TRUE";

  // 2. The bidder's column pair in the Bid-Management grid.
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidManagementSheet}'!1:300` });
  const values = dataRes.data.values || [];
  if (values.length === 0) throw new Error("Bid sheet is empty");
  const colIndex = findBidderColumn(values, bidderId);
  if (colIndex === -1) throw new Error("Bidder column not found in Bid Management sheet");

  // 3. One winner per item unless the item allows several (Milestone A).
  const existing = await checkOneWinnerPerItem(sheets, values, { bidderId, itemId, price, itemsSpreadsheetId });
  if (existing === "already-recorded") {
    return { success: true, followUpAdded: false, alreadyRecorded: true };
  }

  // 4. Write the bid in the bidder's first empty row (and the Follow-Up row).
  const rowIndex = firstEmptyBidRow(values, colIndex);
  const operations: SheetOp[] = [{
    type: 'UPDATE',
    spreadsheetId,
    range: `${bidManagementSheet}!${getColumnLetter(colIndex)}${rowIndex}:${getColumnLetter(colIndex + 1)}${rowIndex}`,
    newValues: [[itemId, price]]
  }];
  if (isCheckedOut) {
    await ensureSheetTab(sheets, spreadsheetId, "Follow-Up", FOLLOW_UP_HEADER);
    operations.push({ type: 'APPEND', spreadsheetId, range: `Follow-Up!A:C`, newValues: [[bidderId, itemId, price]] });
  }

  await executeGoogleSheetsTransaction(sheets, operations);
  return { success: true, followUpAdded: isCheckedOut };
}

/**
 * Bid Entry checks for an existing winner too, but a bid resent from a
 * device that was offline can't see what other devices recorded meanwhile,
 * so the server checks again (safe: the caller holds the bidder-numbers
 * lock). Throws WinningBidConflictError when a one-winner item already has
 * a different winning bid; returns "already-recorded" when this exact bid
 * is already in the sheet (a resend whose first answer never arrived).
 * Skipped when the Items sheet can't be read - the same as before the
 * check existed - so that can't stop bid entry.
 */
async function checkOneWinnerPerItem(
  sheets: sheets_v4.Sheets,
  gridRows: any[][],
  bid: { bidderId: string; itemId: string; price: number; itemsSpreadsheetId?: string }
): Promise<"ok" | "already-recorded"> {
  const existingWins = findExistingWins(gridRows, bid.itemId);
  if (existingWins.length === 0 || !bid.itemsSpreadsheetId) return "ok";

  let repeatable: boolean | undefined;
  try {
    const itemsRes = await sheets.spreadsheets.values.get({ spreadsheetId: bid.itemsSpreadsheetId, range: "'Auction-Items'!A:M" });
    repeatable = isRepeatableItem(itemsRes.data.values || [], bid.itemId);
  } catch (e: any) {
    console.warn(`[recordWinningBid] Couldn't read the Items sheet to check item ${bid.itemId}; skipping the one-winner check:`, e?.message || e);
  }
  if (repeatable !== false) return "ok";

  const sameBid = existingWins.find((w) => w.bidderId === String(bid.bidderId).trim() && Math.abs(w.price - bid.price) < 0.005);
  if (sameBid) return "already-recorded";
  throw new WinningBidConflictError(
    `Item #${bid.itemId} already has a winning bid (bidder ${existingWins[0].bidderId}, $${existingWins[0].price.toFixed(2)}), so this bid wasn't recorded.`
  );
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

/** Bidder-Numbers G:I (Checked Out, Paid, Payment Method) and L (PayPal Pending Since) for one bidder row. */
function paymentStatusOps(
  spreadsheetId: string,
  bidderNumbersSheet: string,
  sheetRow: number,
  status: { done: boolean; label: string; pendingSince: string }
): SheetOp[] {
  return [
    { type: 'UPDATE', spreadsheetId, range: `'${bidderNumbersSheet}'!G${sheetRow}:I${sheetRow}`, newValues: [[status.done, status.done, status.label]] },
    { type: 'UPDATE', spreadsheetId, range: `'${bidderNumbersSheet}'!L${sheetRow}`, newValues: [[status.pendingSince]] }
  ];
}

/**
 * Closes a cash/check payer's PayPal invoice so they can't also pay it
 * online. They don't owe the card surcharge, so that line comes off first
 * and the payment is recorded at what's left - leaving no balance
 * (ROADMAP.md L3). If the surcharge can't be removed, the payment is
 * recorded at the invoice's full total (Column K) instead, which still
 * closes it. Column K is left as is: it's what a later receipt run compares
 * against to reuse this invoice, so changing it would make that run cancel
 * this invoice and send a new one.
 *
 * Never throws - the cash/check is in hand - but returns a warning for
 * staff when something needs fixing by hand.
 */
async function settleOfflineInvoice(
  paypal: PayPalService,
  invoiceId: string,
  label: string,
  bidderId: string,
  invoicedAmountCell: any
): Promise<string | undefined> {
  let amount = parseFloat(invoicedAmountCell) || 0;
  let paidOnlineStatus: string | null = null;
  try {
    const adjusted = await paypal.removeSurchargeLine(invoiceId);
    if (isPaidInvoiceStatus(adjusted.status)) paidOnlineStatus = adjusted.status;
    else amount = adjusted.total;
  } catch (e: any) {
    console.warn(`[checkout] Couldn't remove the card surcharge from invoice ${invoiceId}; recording the full invoice amount instead: ${e?.message || e}`);
  }

  if (paidOnlineStatus) {
    return `Bidder ${bidderId} is marked paid (${label}), but PayPal shows invoice ${invoiceId} as already paid (${paidOnlineStatus}). ` +
      `Check for a double payment before taking the ${label.toLowerCase()}.`;
  }

  let recorded = false;
  let reason = "PayPal rejected the request";
  try {
    recorded = await paypal.recordOfflinePayment(invoiceId, label, amount);
  } catch (e: any) {
    reason = e?.message || String(e);
  }
  if (recorded) return undefined;
  console.warn(`[checkout] Couldn't record bidder ${bidderId}'s ${label.toLowerCase()} payment on PayPal invoice ${invoiceId}: ${reason}`);
  return `Bidder ${bidderId} is marked paid (${label}), but PayPal didn't record the payment on invoice ${invoiceId}, so it can still be paid online. ` +
    `Mark it paid in the PayPal dashboard.`;
}

/**
 * A card payer's live PayPal invoice status. When no invoice was ever made
 * (staff didn't print or email the receipt first), creates one now with
 * the same get-or-create logic the receipt routes use, which also writes
 * the URL/amount into columns J/K - otherwise checkout would mark
 * "PayPal Verification Pending" with nothing to pay and nothing for the
 * sweeper to resolve. A new invoice can't be paid yet, so that's "UNPAID".
 */
async function cardInvoiceStatus(auth: OAuth2Client, paypal: PayPalService, invoiceId: string | null, params: CheckoutParams): Promise<string> {
  try {
    if (invoiceId) return await paypal.getInvoiceStatus(invoiceId);

    if (!params.itemsSpreadsheetId) {
      throw new Error("Auction Items Spreadsheet ID is required to create a PayPal invoice.");
    }
    const invoiceResult = await buildBidderReceiptWithInvoice(auth, params.spreadsheetId, params.itemsSpreadsheetId, params.bidderId, paypal, {
      bidderNumbers: params.bidderNumbersSheet,
      bidManagement: params.bidManagementSheet || DEFAULT_SHEET_NAMES.bidManagement,
    });
    if (invoiceResult.success === false) {
      throw new Error(invoiceResult.error);
    }
    return "UNPAID";
  } catch (err: any) {
    throw new Error("Credit Card validation processing error: " + err.message);
  }
}

async function checkoutMarkPaidLocked(
  auth: OAuth2Client,
  params: CheckoutParams
): Promise<CheckoutResult> {
  const { bidderId, spreadsheetId, ticketsSpreadsheetId, bidderNumbersSheet, paymentMethod, paypalIsSandbox, attendeeInfo } = params;
  const sheets = google.sheets({ version: "v4", auth });

  // 1. The bidder's Bidder-Numbers row and their PayPal invoice, if any.
  const bidderSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidderNumbersSheet}'!A:L` });
  const bidderRows = bidderSearch.data.values || [];
  const targetRowIndex = findBidderRowIndex(bidderRows, bidderId);
  if (targetRowIndex === -1) {
    throw new Error("Bidder ID not found");
  }
  const sheetRow = targetRowIndex + 1; // 1-based sheet row
  const bidderRow = bidderRows[targetRowIndex];
  const paypal = new PayPalService({ isSandbox: paypalIsSandbox !== false });
  const invoiceId = paypal.extractInvoiceIdFromUrl(bidderRow[BIDDER_COL.invoiceUrl]);

  // 2. Work out the payment status (and settle the invoice for cash/check).
  const method = (paymentMethod || "cash").toString();
  let deferred = false;
  let warning: string | undefined;
  let paymentOps: SheetOp[];

  if (method === "cash" || method === "check") {
    const label = method === "cash" ? "Cash" : "Check";
    paymentOps = paymentStatusOps(spreadsheetId, bidderNumbersSheet, sheetRow, { done: true, label, pendingSince: "" });
    if (invoiceId) {
      warning = await settleOfflineInvoice(paypal, invoiceId, label, bidderId, bidderRow[BIDDER_COL.invoicedAmount] || 0);
    }
  } else if (method === "credit_card") {
    const liveStatus = await cardInvoiceStatus(auth, paypal, invoiceId, params);
    if (isPaidInvoiceStatus(liveStatus)) {
      paymentOps = paymentStatusOps(spreadsheetId, bidderNumbersSheet, sheetRow, { done: true, label: "Credit Card / PayPal", pendingSince: "" });
    } else {
      // Not paid yet: the PayPal sweeper finishes the checkout once it is.
      deferred = true;
      paymentOps = paymentStatusOps(spreadsheetId, bidderNumbersSheet, sheetRow, { done: false, label: "PayPal Verification Pending", pendingSince: new Date().toISOString() });
    }
  } else {
    throw new Error("Unknown checkout payment method specified: " + method);
  }

  // 3. Record it.
  await executeGoogleSheetsTransaction(sheets, paymentOps);
  if (deferred) {
    // Column L now holds a timestamp - make sure it has a label.
    await ensureTrackingHeaders(sheets, spreadsheetId, bidderNumbersSheet).catch((e) => console.warn("[checkout] Could not label Bidder-Numbers L1:N1:", e?.message || e));
  }

  // 4. Mark their ticket paid on the 'tickets' tab, when the browser sent its row.
  let attendeeUpdated = false;
  if (ticketsSpreadsheetId && attendeeInfo?.sheet && attendeeInfo.rowIndex) {
    await executeGoogleSheetsTransaction(sheets, [{
      type: 'UPDATE',
      spreadsheetId: ticketsSpreadsheetId,
      range: `${attendeeInfo.sheet}!${getColumnLetter(TICKETS_COL.paymentStatus)}${attendeeInfo.rowIndex}`,
      newValues: [["Paid"]]
    }]);
    attendeeUpdated = true;
  }

  return { success: true, attendeeUpdated, deferred, ...(warning ? { warning } : {}) };
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
    const id = bidderRows[i][BIDDER_COL.id]?.toString();
    const checkedIn = bidderRows[i][BIDDER_COL.checkedIn] === "TRUE" || bidderRows[i][BIDDER_COL.checkedIn] === "true";
    const checkedOut = bidderRows[i][BIDDER_COL.checkedOut] === "TRUE" || bidderRows[i][BIDDER_COL.checkedOut] === "true";
    
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
    }, IDEMPOTENT_POST_RETRY);
  }

  return { success: true, count: updates.length };
}
