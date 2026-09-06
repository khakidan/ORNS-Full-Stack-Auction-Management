import { google } from "googleapis";

/**
 * Single shared implementation of "resolve a bidder's winning items and
 * total" - this used to be duplicated in two places: Node's
 * emailService.ts (for the emailed receipt) and
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_ReceiptManager.gs's
 * `findBidderColInBidSheet_`/`buildReceipt_` (for the printed/PDF receipt
 * and the PayPal invoice). See docs/agents/refactor-opportunities.md's
 * Code Hardening item #2 and CHANGELOG.md for the full history.
 *
 * `getOrCreateInvoiceUrl`/`getPaymentLink` (the PayPal-invoice-creating
 * methods) deliberately stay in Class_ReceiptManager.gs for now - that's
 * a separate backlog item (moving Class_PayPalService.gs's invoice CRUD
 * to Node), not this one.
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
