import { sheets_v4 } from "googleapis";
import { getCategoryBase, resequenceCategoryIds } from "../utils/categoryHelpers";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";
import { calculateMinRaiseAmount } from "../utils/minRaiseHelpers";
import { withLock } from "../utils/asyncLock";
import { ITEM_COL } from "../utils/sheetColumns";

export interface AddItemParams {
  spreadsheetId: string;
  category: string;
  name: string;
  description?: string;
  value?: string;
  donor?: string;
  itemType?: string;
  allowMultipleWinners?: boolean;
}

export function calculateBidAmounts(value: string, valueCalculations: {minRange: number, minRaise: number}[]): { openingBid: string, minRaise: string } {
  const numericValue = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
  if (numericValue <= 0) return { openingBid: "", minRaise: "" };

  const openingBid = "$" + (numericValue * 0.45).toFixed(2);
  const raiseAmount = calculateMinRaiseAmount(numericValue, valueCalculations || []);

  return { openingBid, minRaise: "$" + raiseAmount.toFixed(2) };
}

export interface AddItemResult {
  success: boolean;
  assigned_id: string;
  rowIndex: number;
}

export interface DeleteItemParams {
  spreadsheetId: string;
  rowIndex: number;
}

export interface UpdateItemParams {
  spreadsheetId: string;
  rowIndex: number;
  /** Field name -> new value; any of ITEM_FIELD_MAPPING's fields, plus allowMultipleWinners. */
  changes: Record<string, any>;
  /**
   * The item name the editor saw at this row. When given and the row now
   * holds a different name, nothing is written (ItemChangedError) - the
   * row's ID can't be used for this, since resequencing renumbers IDs.
   */
  expectedName?: string;
}

/** Thrown when an edit's row no longer holds the item the editor opened. */
export class ItemChangedError extends Error {
  constructor(message = "This item changed since you opened it. Refresh the list and try again.") {
    super(message);
    this.name = "ItemChangedError";
  }
}

export interface BulkUpdateParams {
  spreadsheetId: string;
  rowIndices: number[];
  field: string;
  value: any;
}

/**
 * Common helper to fetch categories and their base numbers.
 */
async function fetchCategoryBases(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<Record<string, number>> {
  const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Categories'!A:C" });
  const baseNumbers: Record<string, number> = {};
  (catSearch.data.values || []).slice(1).forEach(row => {
    const catName = (row[0] || "").toString().trim();
    const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
    if (catName) {
      baseNumbers[catName] = catBase || getCategoryBase(catName);
    }
  });
  return baseNumbers;
}

/**
 * Adds a new auction item and triggers re-sequencing.
 *
 * Wrapped in withLock, keyed per spreadsheet - this reads the full
 * 'Auction-Items'!A:L range, mutates the in-memory 2D array, then
 * overwrites the whole range. Two staff working item-entry/bundling
 * concurrently (a realistic pre-event pattern) could otherwise read the
 * same snapshot and the second write would silently discard the first's
 * change. Found in a hardening audit - see
 * docs/agents/CHANGELOG.md's Code Hardening item #1 /
 * CHANGELOG.md. Shares a lock key with deleteItem/updateItem/
 * bulkUpdateItems/processBundle/restoreBundle - all mutate the same
 * 'Auction-Items' range.
 */
export async function addItem(sheets: sheets_v4.Sheets, params: AddItemParams): Promise<AddItemResult> {
  return withLock(`auction-items:${params.spreadsheetId}`, () => addItemLocked(sheets, params));
}

async function addItemLocked(sheets: sheets_v4.Sheets, params: AddItemParams): Promise<AddItemResult> {
  const { spreadsheetId, category, name, description, value, donor, itemType, allowMultipleWinners } = params;

  // Fetch Category Bases and Value Calculations in parallel
  const [baseNumbers, settingsRes, dataRes] = await Promise.all([
    fetchCategoryBases(sheets, spreadsheetId),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "'Value Calculations'!A:B" }).catch(() => null),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" })
  ]);
  
  const valueCalculations = [];
  if (settingsRes && settingsRes.data && settingsRes.data.values) {
    const rows = settingsRes.data.values.slice(1); // skip header
    for (const row of rows) {
      if (row[0] && row[1]) {
        const minRange = parseFloat(row[0].toString().replace(/[^0-9.-]+/g, ""));
        const minRaise = parseFloat(row[1].toString().replace(/[^0-9.-]+/g, ""));
        if (!isNaN(minRange) && !isNaN(minRaise)) {
          valueCalculations.push({ minRange, minRaise });
        }
      }
    }
  }

  const { openingBid, minRaise } = calculateBidAmounts(value || "", valueCalculations);

  const values = dataRes.data.values || [];

  if (values.length === 0) {
    values.push([
      "Auction Item ID", "Category", "Item Name", "Description", "Value", 
      "Opening Bid", "Min Raise Amount", "Donated By", 
      "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"
    ]);
  }

  const newRow = [
    "TEMP",
    category,
    name,
    description || "",
    value || "",
    openingBid || "",
    minRaise || "",
    donor || "",
    itemType || "",
    "Active",
    "",
    ""
  ];
  values.push(newRow);

  resequenceCategoryIds(values, new Set([category]), baseNumbers);

  const rowIndex = values.length;

  // Column M ("Allow Multiple Winners") lives outside the A:L range this
  // function otherwise reads/writes/resequences - written as its own
  // single-cell update (mirrors useAuctionItemUpdate.ts's handleUpdate
  // convention) so it never risks touching any other row's M value.
  // Issued before the main A1:L write below so callers that inspect "the
  // last sheet write" (e.g. this repo's test mocks) still see the real
  // new row, not this one-cell write.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'Auction-Items'!M${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[!!allowMultipleWinners]] }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "'Auction-Items'!A1:L",
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });

  clearCacheForSpreadsheet(spreadsheetId);

  return {
    success: true,
    assigned_id: newRow[0],
    rowIndex
  };
}

/**
 * Soft-deletes an auction item and triggers re-sequencing.
 *
 * Wrapped in withLock - see addItem's docblock for why.
 */
/** What a delete changed, for Action History (DeleteItemResult.before is the row's old status). */
export interface DeleteItemResult {
  success: boolean;
  name: string;
  before: { status: string };
}

export async function deleteItem(sheets: sheets_v4.Sheets, params: DeleteItemParams): Promise<DeleteItemResult> {
  return withLock(`auction-items:${params.spreadsheetId}`, () => deleteItemLocked(sheets, params));
}

async function deleteItemLocked(sheets: sheets_v4.Sheets, params: DeleteItemParams): Promise<DeleteItemResult> {
  const { spreadsheetId, rowIndex } = params;

  const baseNumbers = await fetchCategoryBases(sheets, spreadsheetId);
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const values = dataRes.data.values || [];

  if (!values[rowIndex - 1]) {
    throw new Error(`Row ${rowIndex} not found in the spreadsheet.`);
  }

  const row = values[rowIndex - 1];
  const category = row[ITEM_COL.category];
  const previousStatus = String(row[ITEM_COL.status] ?? "");

  row[ITEM_COL.id] = "";
  row[ITEM_COL.status] = "Deleted";

  if (category) {
    resequenceCategoryIds(values, new Set([category]), baseNumbers);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId, 
    range: "'Auction-Items'!A1:L", 
    valueInputOption: "USER_ENTERED", 
    requestBody: { values }
  });

  clearCacheForSpreadsheet(spreadsheetId);

  return { success: true, name: String(row[ITEM_COL.name] ?? ""), before: { status: previousStatus } };
}

/** Fields update-item / bulk-update-items can set, and their A-L column (allowMultipleWinners, in M, is handled separately). */
const { allowMultipleWinners: _columnM, ...ITEM_FIELD_MAPPING } = ITEM_COL;
const isItemField = (field: string): field is keyof typeof ITEM_FIELD_MAPPING => Object.hasOwn(ITEM_FIELD_MAPPING, field);

/** Column M - outside the A:L range the other item writes read and rewrite. */
const ALLOW_MULTIPLE_WINNERS_FIELD = "allowMultipleWinners";

/**
 * Saves one or more fields of an auction item in a single locked write,
 * resequencing IDs when the category or status changes.
 *
 * Wrapped in withLock - see addItem's docblock for why. Every item edit
 * goes through here (not the generic /api/sheets passthrough), so an edit
 * can't land between another writer's read and its whole-range rewrite
 * and be lost.
 */
/** `before` holds the changed fields' old values and `name` the item's name after the edit, for Action History. */
export interface UpdateItemResult {
  success: boolean;
  affected_categories: string[];
  name: string;
  before: Record<string, unknown>;
}

export async function updateItem(sheets: sheets_v4.Sheets, params: UpdateItemParams): Promise<UpdateItemResult> {
  return withLock(`auction-items:${params.spreadsheetId}`, () => updateItemLocked(sheets, params));
}

async function updateItemLocked(sheets: sheets_v4.Sheets, params: UpdateItemParams): Promise<UpdateItemResult> {
  const { spreadsheetId, rowIndex, changes, expectedName } = params;

  const fields = Object.keys(changes);
  if (fields.length === 0) throw new Error("Invalid field: no changes given");
  for (const field of fields) {
    if (field !== ALLOW_MULTIPLE_WINNERS_FIELD && !isItemField(field)) {
      throw new Error(`Invalid field: ${field}`);
    }
  }

  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const values = dataRes.data.values || [];

  // Row 1 is the header; a real item row is 2 or later.
  if (rowIndex < 2 || !values[rowIndex - 1]) {
    throw new Error(`Row ${rowIndex} not found`);
  }

  const row = values[rowIndex - 1];
  if (expectedName !== undefined && String(row[ITEM_COL.name] ?? "").trim() !== expectedName.trim()) {
    throw new ItemChangedError();
  }

  const oldCategory = row[ITEM_COL.category];
  const before: Record<string, unknown> = {};
  for (const field of fields) {
    if (!isItemField(field)) continue;
    before[field] = row[ITEM_FIELD_MAPPING[field]] ?? "";
    row[ITEM_FIELD_MAPPING[field]] = changes[field];
  }

  const affectedCategories = new Set<string>();
  if ("category" in changes) {
    if (oldCategory) affectedCategories.add(oldCategory);
    if (changes.category) affectedCategories.add(changes.category);
  } else if ("status" in changes) {
    if (row[ITEM_COL.category]) affectedCategories.add(row[ITEM_COL.category]);
  }

  if (ALLOW_MULTIPLE_WINNERS_FIELD in changes) {
    const old = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'Auction-Items'!M${rowIndex}` });
    const oldCell = old.data.values?.[0]?.[0];
    before[ALLOW_MULTIPLE_WINNERS_FIELD] = oldCell === true || String(oldCell ?? "").toUpperCase() === "TRUE";
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Auction-Items'!M${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[!!changes[ALLOW_MULTIPLE_WINNERS_FIELD]]] }
    });
  }

  if (affectedCategories.size > 0) {
    const baseNumbers = await fetchCategoryBases(sheets, spreadsheetId);
    resequenceCategoryIds(values, affectedCategories, baseNumbers);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'Auction-Items'!A1:L",
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
  } else if (fields.some((f) => f !== ALLOW_MULTIPLE_WINNERS_FIELD)) {
    // No ID changes, so only this item's own row is rewritten.
    const fullRow = Array.from({ length: 12 }, (_, i) => row[i] ?? "");
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Auction-Items'!A${rowIndex}:L${rowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [fullRow] }
    });
  }

  clearCacheForSpreadsheet(spreadsheetId);

  return { success: true, affected_categories: Array.from(affectedCategories), name: String(row[ITEM_COL.name] ?? ""), before };
}

/**
 * Bulk updates a field for multiple auction items and manages re-sequencing.
 *
 * Wrapped in withLock - see addItem's docblock for why.
 */
/** `rows` holds each changed row's old value, for Action History. */
export interface BulkUpdateResult {
  success: boolean;
  affected_categories: string[];
  rows: { rowIndex: number; name: string; before: unknown }[];
}

export async function bulkUpdateItems(sheets: sheets_v4.Sheets, params: BulkUpdateParams): Promise<BulkUpdateResult> {
  return withLock(`auction-items:${params.spreadsheetId}`, () => bulkUpdateItemsLocked(sheets, params));
}

async function bulkUpdateItemsLocked(sheets: sheets_v4.Sheets, params: BulkUpdateParams): Promise<BulkUpdateResult> {
  const { spreadsheetId, rowIndices, field, value } = params;

  const baseNumbers = await fetchCategoryBases(sheets, spreadsheetId);
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const values = dataRes.data.values || [];

  if (!isItemField(field)) throw new Error(`Invalid field: ${field}`);
  const colIdx = ITEM_FIELD_MAPPING[field];

  const affectedCategories = new Set<string>();
  const changedRows: BulkUpdateResult["rows"] = [];

  for (const rowIndex of rowIndices) {
    if (!values[rowIndex - 1]) continue;
    const row = values[rowIndex - 1];
    const oldCategory = row[ITEM_COL.category];

    changedRows.push({ rowIndex, name: String(row[ITEM_COL.name] ?? ""), before: row[colIdx] ?? "" });
    row[colIdx] = value;

    if (field === 'category') {
      if (oldCategory) affectedCategories.add(oldCategory);
      if (value) affectedCategories.add(value);
    } else if (field === 'status') {
      const category = row[ITEM_COL.category];
      if (category) affectedCategories.add(category);
    }
  }

  if (affectedCategories.size > 0) {
    resequenceCategoryIds(values, affectedCategories, baseNumbers);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId, 
    range: "'Auction-Items'!A1:L", 
    valueInputOption: "USER_ENTERED", 
    requestBody: { values }
  });

  clearCacheForSpreadsheet(spreadsheetId);

  return { success: true, affected_categories: Array.from(affectedCategories), rows: changedRows };
}
