import { google } from "googleapis";
import { PayPalService, PayPalBidderInfo, PayPalLineItem } from "./paypalService";
import { calculatePayPalSurcharge } from "../utils/financeUtils";

/**
 * Single shared implementation of "resolve a bidder's winning items and
 * total" - this used to be duplicated in two places: Node's
 * emailService.ts (for the emailed receipt) and
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_ReceiptManager.gs's
 * `findBidderColInBidSheet_`/`buildReceipt_` (for the printed/PDF receipt
 * and the PayPal invoice). See docs/agents/refactor-opportunities.md's
 * Code Hardening item #2 and CHANGELOG.md for the full history.
 *
 * `getOrCreateInvoiceUrl`'s invoice get-or-create logic (Code Hardening
 * item #2, Step 2) now also lives here - `resolveInvoiceUrl`/
 * `buildBidderReceiptWithInvoice`/`buildAllBidderReceiptsWithInvoices`
 * below - so `Class_ReceiptManager.gs` no longer calls PayPalService at
 * all; it just consumes the `paymentUrl`/`adjustedTotal` Node attaches to
 * each receipt.
 */

export interface BidderReceiptItems {
  itemsWon: string[];
  itemNames: string[];
  itemPrices: number[];
  totalCost: number;
}

export interface BidderReceiptData extends BidderReceiptItems {
  bidId: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface BidderReceiptWithInvoice extends BidderReceiptData {
  paymentUrl: string;
  adjustedTotal: number;
}

export interface ExistingInvoice {
  /** 1-based sheet row, for a Bidder-Numbers `J{row}:K{row}` range. */
  rowIndex: number;
  url: string;
  amount: number;
}

/**
 * Builds an item-ID lookup function from the Items spreadsheet's
 * Auction-Items rows (already fetched) - the same fuzzy header detection
 * emailService.ts always used (ID/Name columns by header text, with safe
 * positional defaults), so this stays a pure refactor of existing,
 * already-tested behavior.
 */
export function buildItemNameLookup(itemsRows: any[][]): (itemId: string) => string {
  const itemsHead = itemsRows[0] || [];
  const itemsHeadLower = itemsHead.map((h: any) => String(h || "").toLowerCase().trim());

  const getCol = (names: string[], defaultIdx: number) => {
    const idx = itemsHeadLower.findIndex((h: string) => names.some(n => h === n || h.includes(n)));
    return idx !== -1 ? idx : defaultIdx;
  };

  const itemIdIdx = getCol(["item number", "number", "id"], 0);
  const itemNameIdx = getCol(["item name", "name"], 2);

  return (itemId: string) => {
    for (let j = 1; j < itemsRows.length; j++) {
      const itemRow = itemsRows[j];
      if (String(itemRow[itemIdIdx] || "").trim() === itemId.trim()) {
        return itemRow[itemNameIdx] || "Unknown Item";
      }
    }
    return "Unknown Item";
  };
}

/**
 * Finds a bidder's 0-based column index in the Bid-Management header row
 * (row 0), scanning in ID/price pairs - mirrors
 * Class_ReceiptManager.gs's (now-removed) `findBidderColInBidSheet_`.
 * Returns -1 when not found.
 */
export function findBidderColumn(mgmtRows: any[][], bidderId: string): number {
  const headerRow = mgmtRows[0] || [];
  for (let c = 0; c < headerRow.length; c += 2) {
    if (String(headerRow[c] || "").trim() === String(bidderId).trim()) return c;
  }
  return -1;
}

/**
 * Resolves everything a bidder won from an already-fetched Bid-Management
 * grid, given their column index and an item-name lookup - mirrors
 * Class_ReceiptManager.gs's (now-removed) `buildReceipt_` exactly (row 3+
 * item/price pairs).
 */
export function resolveWonItems(mgmtRows: any[][], colIndex: number, getItemName: (id: string) => string): BidderReceiptItems {
  const itemsWon: string[] = [];
  const itemNames: string[] = [];
  const itemPrices: number[] = [];
  let totalCost = 0;

  for (let r = 3; r < mgmtRows.length; r++) {
    const row = mgmtRows[r];
    const itemId = row[colIndex];
    if (itemId) {
      const price = parseFloat(String(row[colIndex + 1]).replace(/[^0-9.]/g, '')) || 0;
      const normalizedId = String(itemId);
      itemsWon.push(normalizedId);
      itemPrices.push(price);
      totalCost += price;
      itemNames.push(getItemName(normalizedId));
    }
  }

  return { itemsWon, itemNames, itemPrices, totalCost };
}

/**
 * Builds one bidder's full receipt (name/email + winning items/total) for
 * the printed/PDF receipt path - handed to
 * Class_GoogleAIStudio.gs's `apiCreateIndividualReceipt` as a parameter so
 * that Apps Script class no longer needs to look any of this up itself.
 */
export async function buildBidderReceipt(
  client: any,
  spreadsheetId: string,
  itemsSpreadsheetId: string,
  bidderId: string
): Promise<{ success: true; receipt: BidderReceiptData } | { success: false; error: string }> {
  const sheets = google.sheets({ version: "v4", auth: client });
  const bMgmt = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bid-Management'!A1:ZZ1000" });
  const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bidder-Numbers'!A:L" });
  const aucItems = await sheets.spreadsheets.values.get({ spreadsheetId: itemsSpreadsheetId, range: "'Auction-Items'!A:Z" });

  const numData = bNum.data.values || [];
  let firstName = "";
  let lastName = "";
  let email = "";
  let found = false;
  for (let i = 1; i < numData.length; i++) {
    if (String(numData[i][0] || "").trim() === String(bidderId).trim()) {
      firstName = numData[i][1] || "";
      lastName = numData[i][2] || "";
      email = numData[i][3] || "";
      found = true;
      break;
    }
  }
  if (!found) return { success: false, error: `Bidder ID ${bidderId} not found in the Bidder-Numbers sheet.` };

  const mgmtData = bMgmt.data.values || [];
  const colIndex = findBidderColumn(mgmtData, bidderId);
  if (colIndex === -1) return { success: false, error: "Bidder ID not found in matrix." };

  const itemsRows = aucItems.data.values || [];
  const getItemName = buildItemNameLookup(itemsRows);
  const items = resolveWonItems(mgmtData, colIndex, getItemName);

  if (items.itemsWon.length === 0) return { success: false, error: "No items won." };

  return {
    success: true,
    receipt: { bidId: String(bidderId), firstName, lastName, email, ...items }
  };
}

/**
 * Builds every bidder's receipt for the batch print path - handed to
 * Class_GoogleAIStudio.gs's `apiCreateAllReceipts` as a parameter, sorted
 * ascending by last name to match the print order
 * Class_BidderManager.gs's (now-removed) `getSortedBidderData_` always
 * produced. Bidders with no winning items are skipped, same as the old
 * per-bidder `hasWinningItems()` check in `processBatch_`.
 */
export async function buildAllBidderReceipts(
  client: any,
  spreadsheetId: string,
  itemsSpreadsheetId: string
): Promise<BidderReceiptData[]> {
  const sheets = google.sheets({ version: "v4", auth: client });
  const bMgmt = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bid-Management'!A1:ZZ1000" });
  const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bidder-Numbers'!A:L" });
  const aucItems = await sheets.spreadsheets.values.get({ spreadsheetId: itemsSpreadsheetId, range: "'Auction-Items'!A:Z" });

  const mgmtData = bMgmt.data.values || [];
  const itemsRows = aucItems.data.values || [];
  const getItemName = buildItemNameLookup(itemsRows);

  const numData = bNum.data.values || [];
  const dataRows = numData.slice(1);

  const sortedRows = [...dataRows].sort((a, b) => {
    const lastA = String(a[2] || "").toLowerCase();
    const lastB = String(b[2] || "").toLowerCase();
    return lastA.localeCompare(lastB);
  });

  const receipts: BidderReceiptData[] = [];
  for (const row of sortedRows) {
    const bidderId = String(row[0] || "").trim();
    if (!bidderId) continue;

    const colIndex = findBidderColumn(mgmtData, bidderId);
    if (colIndex === -1) continue;

    const items = resolveWonItems(mgmtData, colIndex, getItemName);
    if (items.itemsWon.length === 0) continue;

    receipts.push({
      bidId: bidderId,
      firstName: row[1] || "",
      lastName: row[2] || "",
      email: row[3] || "",
      ...items
    });
  }

  return receipts;
}

/**
 * Finds a bidder's existing invoice URL/amount (Bidder-Numbers columns
 * J/K) from an already-fetched grid - mirrors
 * Class_ReceiptManager.gs's (now-removed) `getOrCreateInvoiceUrl`'s
 * bidder-row lookup. Returns null when the bidder isn't in the sheet at
 * all (should not happen for a bidder `buildBidderReceipt`/
 * `buildAllBidderReceipts` already resolved from the same sheet).
 */
export function findExistingInvoice(bidderNumbersRows: any[][], bidderId: string): ExistingInvoice | null {
  for (let i = 1; i < bidderNumbersRows.length; i++) {
    const row = bidderNumbersRows[i];
    const cell = row[0];
    if (cell === null || cell === undefined || String(cell).trim() === "") continue;
    if (String(cell).trim() === String(bidderId).trim()) {
      return {
        rowIndex: i + 1,
        url: String(row[9] || "").trim(),
        amount: parseFloat(row[10]) || 0,
      };
    }
  }
  return null;
}

/**
 * Resolves a bidder's PayPal invoice, mirroring
 * Class_ReceiptManager.gs's (now-removed) `getOrCreateInvoiceUrl`
 * precedence exactly:
 *   1. An existing URL whose invoiced amount still matches the current
 *      total-with-fees (within a $0.01 tolerance) -> reuse it, no PayPal
 *      API call needed beyond the reuse check itself.
 *   2. An existing URL whose amount no longer matches (new winning bids
 *      since the last run) -> best-effort cancel the stale invoice, then
 *      create a fresh one.
 *   3. No existing URL -> create a fresh invoice.
 */
export async function resolveInvoiceUrl(
  paypal: PayPalService,
  receipt: BidderReceiptData,
  bidderId: string,
  existing: ExistingInvoice | null
): Promise<{ paymentUrl: string; totalAmount: number; changed: boolean }> {
  const expectedTotal = calculatePayPalSurcharge(receipt.totalCost).total;

  if (existing && existing.url && existing.url.toLowerCase().startsWith("http")) {
    if (Math.abs(existing.amount - expectedTotal) < 0.01) {
      return { paymentUrl: existing.url, totalAmount: existing.amount, changed: false };
    }

    const oldInvoiceId = paypal.extractInvoiceIdFromUrl(existing.url);
    if (oldInvoiceId) {
      try {
        await paypal.cancelInvoice(oldInvoiceId);
      } catch (e: any) {
        console.warn(`resolveInvoiceUrl: could not cancel stale invoice ${oldInvoiceId} for bidder ${bidderId}. Proceeding to create a new one. Reason: ${e.message || e}`);
      }
    }
  }

  const bidderInfo: PayPalBidderInfo = {
    email: receipt.email || "no-reply@example.com",
    firstName: receipt.firstName,
    lastName: receipt.lastName,
    id: bidderId,
  };
  const lineItems: PayPalLineItem[] = receipt.itemNames.map((name, i) => ({
    name,
    amount: Number(receipt.itemPrices[i]) || 0,
  }));

  const invoiceResult = await paypal.createAndSendInvoice(bidderInfo, lineItems);
  return { paymentUrl: invoiceResult.checkoutUrl, totalAmount: invoiceResult.totalAmount, changed: true };
}

/**
 * Builds one bidder's receipt AND resolves/writes their PayPal invoice in
 * one call - the Node-side replacement for
 * Class_ReceiptManager.gs's `getOrCreateInvoiceUrl` being called from
 * GAS. Used by the `/generate` (single-receipt) route and checkout's
 * credit-card path. Callers must hold the `bidder-numbers:<spreadsheetId>`
 * lock (see attachInvoice).
 */
export async function buildBidderReceiptWithInvoice(
  client: any,
  spreadsheetId: string,
  itemsSpreadsheetId: string,
  bidderId: string,
  paypal: PayPalService
): Promise<{ success: true; receipt: BidderReceiptWithInvoice } | { success: false; error: string }> {
  const receiptResult = await buildBidderReceipt(client, spreadsheetId, itemsSpreadsheetId, bidderId);
  if (receiptResult.success === false) return receiptResult;

  const attached = await attachInvoice(client, spreadsheetId, receiptResult.receipt, paypal);
  if (attached.success === false) return attached;
  return { success: true, receipt: attached.receipt };
}

/**
 * Gives an already-built receipt its PayPal invoice: reuses the bidder's
 * Column J invoice when its amount still matches, otherwise replaces or
 * creates one (resolveInvoiceUrl), saving any new invoice to J/K
 * straight away. Also returns the bidder's 1-based Bidder-Numbers row.
 *
 * Callers must hold the `bidder-numbers:<spreadsheetId>` lock, so two
 * requests for the same bidder can't both see "no invoice yet" and each
 * create (and send) one.
 */
export async function attachInvoice(
  client: any,
  spreadsheetId: string,
  receipt: BidderReceiptData,
  paypal: PayPalService
): Promise<{ success: true; receipt: BidderReceiptWithInvoice; rowIndex: number } | { success: false; error: string }> {
  const sheets = google.sheets({ version: "v4", auth: client });
  const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bidder-Numbers'!A:L" });
  const existing = findExistingInvoice(bNum.data.values || [], receipt.bidId);
  if (!existing) {
    return { success: false, error: `Bidder ID ${receipt.bidId} not found in the Bidder-Numbers sheet.` };
  }

  const { paymentUrl, totalAmount, changed } = await resolveInvoiceUrl(paypal, receipt, receipt.bidId, existing);

  if (changed) {
    await persistInvoice(sheets, spreadsheetId, existing.rowIndex, paymentUrl, totalAmount);
  }

  return { success: true, receipt: { ...receipt, paymentUrl, adjustedTotal: totalAmount }, rowIndex: existing.rowIndex };
}

/** Writes one bidder's freshly created invoice URL/amount into Bidder-Numbers columns J/K. */
async function persistInvoice(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  rowIndex: number,
  paymentUrl: string,
  totalAmount: number
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'Bidder-Numbers'!J${rowIndex}:K${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[paymentUrl, totalAmount]] },
  });
}

/**
 * Builds every bidder's receipt AND resolves/writes their PayPal invoices
 * for the batch print path - the Node-side replacement for
 * `processBatch_` calling `getOrCreateInvoiceUrl` once per bidder from
 * GAS. One bidder's invoice failure (e.g. a PayPal API error) is logged
 * and skipped rather than aborting the whole batch, matching
 * `processBatch_`'s own per-bidder try/catch resilience.
 *
 * Each newly created invoice is written to J/K immediately, before the
 * next bidder is touched (ROADMAP.md H1). createAndSendInvoice has
 * already had PayPal email the bidder by the time it returns, so a
 * write deferred to the end of the loop meant any batch that died
 * part-way (Cloud Run request timeout, a Sheets 429, a client retry
 * re-running the route) left sent-but-unrecorded invoices that the next
 * run would duplicate. For the same reason, a failed J/K write aborts the
 * batch instead of being skipped: if Sheets writes are failing, carrying
 * on would just send more invoices nothing records.
 *
 * Callers must hold the `bidder-numbers:<spreadsheetId>` lock (see
 * receiptRoutes.ts) so this can't race checkout's own invoice creation.
 */
export async function buildAllBidderReceiptsWithInvoices(
  client: any,
  spreadsheetId: string,
  itemsSpreadsheetId: string,
  paypal: PayPalService,
  /** Only these bidders get an invoice (and a result) - e.g. email-all skips bidders with no email address. */
  include: (receipt: BidderReceiptData) => boolean = () => true
): Promise<BidderReceiptWithInvoice[]> {
  const receipts = (await buildAllBidderReceipts(client, spreadsheetId, itemsSpreadsheetId)).filter(include);

  const sheets = google.sheets({ version: "v4", auth: client });
  const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bidder-Numbers'!A:L" });
  const bidderNumbersRows = bNum.data.values || [];

  const results: BidderReceiptWithInvoice[] = [];

  for (const receipt of receipts) {
    const existing = findExistingInvoice(bidderNumbersRows, receipt.bidId);
    if (!existing) {
      console.error(`buildAllBidderReceiptsWithInvoices: bidder ${receipt.bidId} unexpectedly missing from Bidder-Numbers during invoice resolution; skipping.`);
      continue;
    }

    let resolved: Awaited<ReturnType<typeof resolveInvoiceUrl>>;
    try {
      resolved = await resolveInvoiceUrl(paypal, receipt, receipt.bidId, existing);
    } catch (e: any) {
      console.error(`buildAllBidderReceiptsWithInvoices: failed to resolve invoice for bidder ${receipt.bidId}. ${e.message || e}`);
      continue;
    }

    const { paymentUrl, totalAmount, changed } = resolved;
    if (changed) {
      try {
        await persistInvoice(sheets, spreadsheetId, existing.rowIndex, paymentUrl, totalAmount);
      } catch (e: any) {
        throw new Error(
          `Stopped generating receipts: PayPal invoice ${paymentUrl} was sent to bidder ${receipt.bidId} but could not be saved to Bidder-Numbers row ${existing.rowIndex} (J/K). ` +
          `Enter it there by hand before re-running, or a duplicate invoice will be sent. Cause: ${e.message || e}`
        );
      }
    }
    results.push({ ...receipt, paymentUrl, adjustedTotal: totalAmount });
  }

  return results;
}
