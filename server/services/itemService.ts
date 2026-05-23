import { sheets_v4 } from "googleapis";
import { getCategoryBase } from "../utils/categoryHelpers";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";

export interface AddItemParams {
  spreadsheetId: string;
  category: string;
  name: string;
  description?: string;
  value?: string;
  donor?: string;
  itemType?: string;
}

export function calculateBidAmounts(value: string, valueCalculations: {minRange: number, minRaise: number}[]): { openingBid: string, minRaise: string } {
  const numericValue = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
  if (numericValue <= 0) return { openingBid: "", minRaise: "" };

  const openingBid = "$" + (numericValue * 0.45).toFixed(2);
  let raiseAmount = 5;
  
  if (valueCalculations && valueCalculations.length > 0) {
    const sorted = [...valueCalculations].sort((a, b) => a.minRange - b.minRange);
    for (const tier of sorted) {
      if (numericValue >= tier.minRange) {
        raiseAmount = tier.minRaise;
      }
    }
  }
  
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
  field: string;
  value: any;
}

export interface BulkUpdateParams {
  spreadsheetId: string;
  rowIndices: number[];
  field: string;
  value: any;
}

/**
 * Re-sequences IDs for specific categories in the values array to ensure no gaps.
 */
function resequenceCategoryIds(values: any[][], categories: Set<string>, baseNumbers: Record<string, number>) {
  for (const cat of categories) {
    if (!cat) continue;
    const rowMapping: { origIndex: number, row: any[] }[] = [];
    for (let i = 1; i < values.length; i++) {
      const r = values[i] || [];
      if (r[1] === cat && r[9] === "Active") {
        rowMapping.push({ origIndex: i, row: r });
      }
    }

    rowMapping.sort((a, b) => {
      const idA = a.row[0] === "TEMP" ? 999999 : (parseInt(a.row[0]) || 999999);
      const idB = b.row[0] === "TEMP" ? 999999 : (parseInt(b.row[0]) || 999999);
      if (idA !== idB) return idA - idB;
      return a.origIndex - b.origIndex;
    });

    const startNum = baseNumbers[cat] || getCategoryBase(cat);
    let runningNum = startNum;
    rowMapping.forEach(item => {
      item.row[0] = runningNum.toString();
      runningNum++;
    });
  }
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
 */
export async function addItem(sheets: sheets_v4.Sheets, params: AddItemParams): Promise<AddItemResult> {
  const { spreadsheetId, category, name, description, value, donor, itemType } = params;

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
    rowIndex: values.length
  };
}

/**
 * Soft-deletes an auction item and triggers re-sequencing.
 */
export async function deleteItem(sheets: sheets_v4.Sheets, params: DeleteItemParams): Promise<{ success: boolean }> {
  const { spreadsheetId, rowIndex } = params;

  const baseNumbers = await fetchCategoryBases(sheets, spreadsheetId);
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const values = dataRes.data.values || [];

  if (!values[rowIndex - 1]) {
    throw new Error(`Row ${rowIndex} not found in the spreadsheet.`);
  }

  const row = values[rowIndex - 1];
  const category = row[1];

  row[0] = "";
  row[9] = "Deleted";

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

  return { success: true };
}

/**
 * Field mapping for item sheets.
 */
const ITEM_FIELD_MAPPING: Record<string, number> = {
  id: 0,
  category: 1,
  name: 2,
  description: 3,
  value: 4,
  openingBid: 5,
  minRaise: 6,
  donor: 7,
  itemType: 8,
  status: 9,
  bundleId: 10,
  bundledDateTime: 11
};

/**
 * Updates a specific field of an auction item and manages re-sequencing if necessary.
 */
export async function updateItem(sheets: sheets_v4.Sheets, params: UpdateItemParams): Promise<{ success: boolean; affected_categories: string[] }> {
  const { spreadsheetId, rowIndex, field, value } = params;

  const baseNumbers = await fetchCategoryBases(sheets, spreadsheetId);
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const values = dataRes.data.values || [];

  if (!values[rowIndex - 1]) {
    throw new Error(`Row ${rowIndex} not found`);
  }

  const row = values[rowIndex - 1];
  const oldCategory = row[1];
  const colIdx = ITEM_FIELD_MAPPING[field];
  if (colIdx === undefined) throw new Error(`Invalid field: ${field}`);

  row[colIdx] = value;

  const affectedCategories = new Set<string>();
  if (field === 'category') {
    if (oldCategory) affectedCategories.add(oldCategory);
    if (value) affectedCategories.add(value);
  } else if (field === 'status') {
    const category = row[1];
    if (category) affectedCategories.add(category);
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

  return { success: true, affected_categories: Array.from(affectedCategories) };
}

/**
 * Bulk updates a field for multiple auction items and manages re-sequencing.
 */
export async function bulkUpdateItems(sheets: sheets_v4.Sheets, params: BulkUpdateParams): Promise<{ success: boolean; affected_categories: string[] }> {
  const { spreadsheetId, rowIndices, field, value } = params;

  const baseNumbers = await fetchCategoryBases(sheets, spreadsheetId);
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const values = dataRes.data.values || [];

  const colIdx = ITEM_FIELD_MAPPING[field];
  if (colIdx === undefined) throw new Error(`Invalid field: ${field}`);

  const affectedCategories = new Set<string>();

  for (const rowIndex of rowIndices) {
    if (!values[rowIndex - 1]) continue;
    const row = values[rowIndex - 1];
    const oldCategory = row[1];
    
    row[colIdx] = value;

    if (field === 'category') {
      if (oldCategory) affectedCategories.add(oldCategory);
      if (value) affectedCategories.add(value);
    } else if (field === 'status') {
      const category = row[1];
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

  return { success: true, affected_categories: Array.from(affectedCategories) };
}

export async function ensureFollowUpSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetName: string): Promise<void> {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId }).catch(() => null);
  
  if (metadata) {
    const hasSheet = metadata.data.sheets?.some(s => s.properties?.title === sheetName);
    if (!hasSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { title: sheetName }
            }
          }]
        }
      });
      if (sheetName === "Follow-Up") {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: "'Follow-Up'!A1:C1",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [["Bidder ID", "Item ID", "Amount"]]
          }
        });
      }
    }
  }
}

