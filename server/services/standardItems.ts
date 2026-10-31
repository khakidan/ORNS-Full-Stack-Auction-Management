import { Request } from "express";
import { sheets_v4 } from "googleapis";
import { getSharedConfig } from "./configService";
import { logAction } from "./actionLog";
import { sheetsFor } from "../utils/googleClients";
import { STANDARD_ITEMS, StandardItem, isStandardItemName, isStandardItemRow, namesOf, norm } from "../../src/lib/standardItems";
import { can } from "../utils/permissions";
import { REFUSALS } from "../middleware/requirePermission";
import { ITEM_COL } from "../utils/sheetColumns";
import { getColumnLetter } from "../utils/columnUtils";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";

export { STANDARD_ITEMS, isStandardItemName };

/**
 * The items every auction sells at a fixed price (src/lib/standardItems.ts):
 * Movie Night, raffle tickets, the Open Appeal tiers and the Auction
 * Tickets item a walk-in's ticket is recorded against
 * (AUCTION_TICKETS_ITEM_ID). Setup New Auction Year seeds them into the
 * Auction-Items spreadsheet - the one list the Auction Items page and Bid
 * Management's Items tab both read - and Set Up and Go Live put back any
 * that went missing (ensureStandardItems).
 *
 * The price goes in Value; Opening Bid and Min Raise stay blank (these
 * aren't bid on). Every one allows more than one winner. The Auction
 * Tickets price is the Config's ticket price.
 */
type ItemRow = (string | boolean)[];

function standardRow(item: StandardItem, id: string, ticketPrice: string): ItemRow {
  const row: ItemRow = Array(ITEM_COL.allowMultipleWinners + 1).fill("");
  row[ITEM_COL.id] = id;
  row[ITEM_COL.category] = item.category;
  row[ITEM_COL.name] = item.name;
  row[ITEM_COL.value] = item.price ?? ticketPrice;
  row[ITEM_COL.status] = "Active";
  row[ITEM_COL.allowMultipleWinners] = true;
  return row;
}

/** Every standard item's row, for Setup New Auction Year's fresh list. */
export function standardItemRows(ticketPrice: string): ItemRow[] {
  return STANDARD_ITEMS.map((item) => standardRow(item, item.id, ticketPrice));
}

const amount = (v: unknown) => parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));

export interface StandardItemsResult {
  /** "1502 Five Raffle Tickets for a $500 Amazon Gift Card", for each item put back. */
  added: string[];
  /** The Auction Tickets item's Value, when it was changed to the ticket price. */
  ticketPrice?: { from: string; to: string };
  /** Standard items whose Allow Multiple Winners was turned back on. */
  multipleWinners?: string[];
  /** Standard items whose blank Value was filled in with their price. */
  pricesFilled?: string[];
}

export interface StandardItemsPlan {
  append: ItemRow[];
  ticketPriceRow?: { rowNumber: number; from: string };
  /** Sheet rows (with their item) whose Allow Multiple Winners is off. */
  multipleWinnersRows: { rowNumber: number; label: string }[];
  /** Sheet rows whose Value is blank, with the price to fill in. */
  blankPriceRows: { rowNumber: number; label: string; price: string }[];
}

/**
 * Pure: what ensureStandardItems writes. An item's row is the one with
 * its name (IDs move when items in a category are added or removed), or
 * failing that its ID and category, unless that row is another standard
 * item - whatever the row now says, an organizer's edits are kept. A
 * missing one is added with its own ID, or the next free one in its
 * category's hundred-block. Exported for tests.
 */
export function planStandardItems(rows: unknown[][], ticketPrice: string): StandardItemsPlan {
  const body = rows.slice(1);
  const ids = new Set(body.map((r) => norm(r?.[ITEM_COL.id])));
  const append: ItemRow[] = [];
  const multipleWinnersRows: StandardItemsPlan["multipleWinnersRows"] = [];
  const blankPriceRows: StandardItemsPlan["blankPriceRows"] = [];
  let ticketPriceRow: StandardItemsPlan["ticketPriceRow"];

  for (const item of STANDARD_ITEMS) {
    const names = namesOf(item);
    let i = body.findIndex((r) => names.includes(norm(r?.[ITEM_COL.name])));
    if (i < 0) {
      i = body.findIndex((r) => norm(r?.[ITEM_COL.id]) === item.id && norm(r?.[ITEM_COL.category]) === norm(item.category) && !isStandardItemName(r?.[ITEM_COL.name]));
    }

    if (i < 0) {
      let id = Number(item.id);
      const blockEnd = Math.floor(id / 100) * 100 + 99;
      while (ids.has(String(id)) && id < blockEnd) id++;
      if (ids.has(String(id))) continue;
      ids.add(String(id));
      append.push(standardRow(item, String(id), ticketPrice));
      continue;
    }

    const row = body[i];
    const label = `${String(row?.[ITEM_COL.id] ?? "").trim()} ${String(row?.[ITEM_COL.name] ?? "").trim()}`;
    const flag = row?.[ITEM_COL.allowMultipleWinners];
    if (!(flag === true || norm(flag) === "true")) multipleWinnersRows.push({ rowNumber: i + 2, label });
    if (item.price === null) {
      if (amount(ticketPrice) > 0 && amount(row?.[ITEM_COL.value]) !== amount(ticketPrice)) {
        ticketPriceRow = { rowNumber: i + 2, from: String(row?.[ITEM_COL.value] ?? "") };
      }
    } else if (!String(row?.[ITEM_COL.value] ?? "").trim()) {
      // A price an organizer typed is theirs; only a blank one is filled.
      blankPriceRows.push({ rowNumber: i + 2, label, price: item.price });
    }
  }
  return { append, ...(ticketPriceRow ? { ticketPriceRow } : {}), multipleWinnersRows, blankPriceRows };
}

/**
 * Puts back any standard item missing from the Auction-Items spreadsheet,
 * turns Allow Multiple Winners back on for any that lost it, fills in a
 * blank Value with the item's price, and keeps the Auction Tickets item's
 * Value at the ticket price. Writes nothing
 * when all is in place.
 */
export async function ensureStandardItems(sheets: sheets_v4.Sheets, itemsSpreadsheetId: string, ticketPrice: string): Promise<StandardItemsResult> {
  const lastCol = getColumnLetter(ITEM_COL.allowMultipleWinners);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: itemsSpreadsheetId, range: `'Auction-Items'!A:${lastCol}` });
  const { append, ticketPriceRow, multipleWinnersRows, blankPriceRows } = planStandardItems(res.data.values || [], ticketPrice);
  if (append.length === 0 && !ticketPriceRow && multipleWinnersRows.length === 0 && blankPriceRows.length === 0) return { added: [] };

  // Cell edits before the append, so their row numbers still hold.
  const cells: sheets_v4.Schema$ValueRange[] = [
    ...(ticketPriceRow ? [{ range: `'Auction-Items'!${getColumnLetter(ITEM_COL.value)}${ticketPriceRow.rowNumber}`, values: [[ticketPrice]] }] : []),
    ...multipleWinnersRows.map((r) => ({ range: `'Auction-Items'!${lastCol}${r.rowNumber}`, values: [[true]] })),
    ...blankPriceRows.map((r) => ({ range: `'Auction-Items'!${getColumnLetter(ITEM_COL.value)}${r.rowNumber}`, values: [[r.price]] })),
  ];
  if (cells.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: itemsSpreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: cells } });
  }
  if (append.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: itemsSpreadsheetId,
      range: `'Auction-Items'!A:${lastCol}`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: append },
    });
  }
  clearCacheForSpreadsheet(itemsSpreadsheetId);
  return {
    added: append.map((r) => `${r[ITEM_COL.id]} ${r[ITEM_COL.name]}`),
    ...(ticketPriceRow ? { ticketPrice: { from: ticketPriceRow.from, to: ticketPrice } } : {}),
    ...(multipleWinnersRows.length ? { multipleWinners: multipleWinnersRows.map((r) => r.label) } : {}),
    ...(blankPriceRows.length ? { pricesFilled: blankPriceRows.map((r) => r.label) } : {}),
  };
}

/**
 * ensureStandardItems for a staff request (Set Up, Go Live), recorded in
 * Action History when it changed anything. Returns what staff should be
 * told, if anything. Never fails the request: a problem is told instead.
 */
export async function ensureStandardItemsFor(req: Request): Promise<{ message?: string }> {
  const config = await getSharedConfig();
  if (!config.auctionItemsSpreadsheetId) return {};
  try {
    const result = await ensureStandardItems(sheetsFor(req), config.auctionItemsSpreadsheetId, String(config.ticketPrice ?? "").trim());
    if (result.added.length > 0 || result.ticketPrice || result.multipleWinners || result.pricesFilled) {
      const parts: string[] = [
        ...(result.added.length ? [`put back ${result.added.length} missing standard item(s): ${result.added.join(", ")}`] : []),
        ...(result.multipleWinners ? [`turned Allow Multiple Winners back on for ${result.multipleWinners.join(", ")}`] : []),
        ...(result.pricesFilled ? [`filled in the price of ${result.pricesFilled.join(", ")}`] : []),
        ...(result.ticketPrice ? [`set the Auction Tickets item's Value to the ticket price, ${result.ticketPrice.to} (was "${result.ticketPrice.from}")`] : []),
      ];
      const summary = parts.join("; ").replace(/^./, (c) => c.toUpperCase());
      await logAction(req, {
        area: "Auction Items",
        action: "Check standard items",
        summary,
        notUndoableReason: "these items are in every auction; edit or remove one on the Auction Items page",
      });
      return { message: `${summary}.` };
    }
    return {};
  } catch (e: any) {
    console.warn("[standardItems] Couldn't check the standard items:", e?.message || e);
    return { message: `Couldn't check the standard items (raffle tickets, Open Appeal, Auction Tickets) on the Auction Items list: ${e?.message || e}` };
  }
}

/**
 * Only an Administrator may change a standard item. Null when `req` may
 * go ahead - an Administrator, or no standard item among the targets (by
 * sheet row, or by item ID for a bundle) - else the refusal to answer
 * with (403). Reads the rows; an unreadable sheet is left to the change
 * itself to report.
 */
export async function refuseStandardItemChange(req: Request, spreadsheetId: string, targets: { rowIndices?: number[]; ids?: string[] }): Promise<string | null> {
  if (req.user && can(req.user.role, "items.standard")) return null;
  const res = await sheetsFor(req).spreadsheets.values.get({ spreadsheetId, range: `'Auction-Items'!A:${getColumnLetter(ITEM_COL.name)}` }).catch(() => null);
  const rows = res?.data.values || [];
  const rowSet = new Set(targets.rowIndices ?? []);
  const idSet = new Set((targets.ids ?? []).map((id) => String(id).trim()));
  const hit = rows.some((r, i) => i > 0 && (rowSet.has(i + 1) || idSet.has(String(r?.[ITEM_COL.id] ?? "").trim())) && isStandardItemRow(r?.[ITEM_COL.id], r?.[ITEM_COL.category], r?.[ITEM_COL.name]));
  return hit ? REFUSALS["items.standard"] : null;
}
