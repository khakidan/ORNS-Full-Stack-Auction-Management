import { sheets_v4 } from "googleapis";
import { genAI } from "../services/genai";
import { getCategoryBase, resequenceCategoryIds } from "../utils/categoryHelpers";
import { calculateMinRaiseAmount } from "../utils/minRaiseHelpers";
import { withLock } from "../utils/asyncLock";
import { ITEM_COL } from "../utils/sheetColumns";

export interface SuggestNamesParams {
  items: Array<{ name: string; description?: string }>;
}

export interface SuggestDescriptionParams {
  items: Array<{ name: string; description?: string }>;
}

export interface ProcessBundleParams {
  spreadsheetId: string;
  targetIds: string[];
  newName: string;
  newDescription?: string;
  targetCategory: string;
  value?: string;
  openingBid?: string;
  minRaise?: string;
  donor?: string;
  itemType?: string;
  bundleEventToken?: string;
  timestamp?: string;
}

export interface RestoreBundleParams {
  spreadsheetId: string;
  targetBundleToken: string;
}

export interface BundleActionResult {
  action_executed: string;
  ui_history_log: {
    bundle_token: string;
    timestamp: string;
    bundle_item_name: string;
    original_item_names: string[];
  };
}

export interface RestoreActionResult {
  success: boolean;
  ui_history_log: {
    original_item_names: string[];
  };
}

/**
 * AI-powered bundle name suggestion.
 */
export async function suggestBundleNames(params: SuggestNamesParams): Promise<{ suggestions: string[] }> {
  const { items } = params;
  const itemsDescription = items.map(it => `- ${it.name}: ${it.description || 'No description'}`).join('\n');
  const prompt = `Suggested names for bundle: ${itemsDescription}`;
  const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash"; // Fixed to valid model alias
  
  const result = await genAI.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction: "You are an expert at creating catchy, themed bundle names for a non-profit preschool's silent auction. Return JSON array of 5 strings.",
      responseMimeType: "application/json"
    }
  });

  const finishReason = result.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') throw new Error("AI generation interrupted");

  const rawText = result.text || "[]";
  return { suggestions: JSON.parse(rawText.replace(/^```json\n?/, "").replace(/\n?```$/, "")) };
}

/**
 * AI-powered bundle description suggestion.
 */
export async function suggestBundleDescription(params: SuggestDescriptionParams): Promise<{ description: string }> {
  const { items } = params;
  const itemsList = items.map(it => `- ${it.name}: ${it.description || 'No description'}`).join('\n');
  const prompt = `Write a professional, catchy, and appealing auction description for a bundle containing these items:\n${itemsList}\n\nThe description MUST be exactly one paragraph long, professional yet exciting for a school fundraiser. Don't use placeholders. Focus on the value and experience of the bundle.`;
  
  const modelName = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const result = await genAI.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction: "You are an expert at writing compelling silent auction descriptions. Return a plain text description that is exactly one paragraph long.",
    }
  });
  
  return { description: result.text || "" };
}

/**
 * Helper to calculate minimum raise based on value and preset tiers.
 */
function calculateMinRaise(value: number, tiers: { minRange: number; minRaise: number }[]): string {
  if (value <= 0) return "$5.00";

  return `$${calculateMinRaiseAmount(value, tiers).toFixed(2)}`;
}

/**
 * Creates a bundle from existing items.
 *
 * Wrapped in withLock, keyed per spreadsheet - shares the same
 * `auction-items:${spreadsheetId}` key as itemService.ts's
 * addItem/deleteItem/updateItem/bulkUpdateItems, since this also reads the
 * full 'Auction-Items'!A:L range, mutates it in memory, then overwrites
 * the whole range. Found in a hardening audit - see
 * docs/agents/CHANGELOG.md's Code Hardening item #1 /
 * CHANGELOG.md.
 */
export async function processBundle(
  sheets: sheets_v4.Sheets,
  params: ProcessBundleParams
): Promise<BundleActionResult> {
  return withLock(`auction-items:${params.spreadsheetId}`, () => processBundleLocked(sheets, params));
}

async function processBundleLocked(
  sheets: sheets_v4.Sheets,
  params: ProcessBundleParams
): Promise<BundleActionResult> {
  const {
    spreadsheetId,
    targetIds,
    newName,
    newDescription,
    targetCategory,
    value,
    openingBid,
    minRaise,
    donor,
    itemType,
    bundleEventToken: clientBundleToken,
    timestamp
  } = params;

  // 1. Fetch Categories and Value Calculations
  const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Categories'!A:C" });
  const baseNumbers: Record<string, number> = {};
  (catSearch.data.values || []).slice(1).forEach(row => {
    const catName = (row[0] || "").toString().trim();
    if (catName) baseNumbers[catName] = parseInt(row[1] || row[2] || "0", 10) || getCategoryBase(catName);
  });

  const calcSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Value Calculations'!A:B" }).catch(() => null);
  const valueCalculations: { minRange: number; minRaise: number }[] = [];
  if (calcSearch && calcSearch.data.values && calcSearch.data.values.length > 1) {
    calcSearch.data.values.slice(1).forEach((row: any[]) => {
      const minRange = parseFloat(row[0]?.toString().replace(/[^0-9.-]+/g, "") || "0");
      const minRaiseVal = parseFloat(row[1]?.toString().replace(/[^0-9.-]+/g, "") || "0");
      if (!isNaN(minRange) && !isNaN(minRaiseVal) && minRaiseVal > 0) {
        valueCalculations.push({ minRange, minRaise: minRaiseVal });
      }
    });
  }

  // 2. Fetch Item Data
  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const values = dataRes.data.values || [];
  const ts = timestamp || new Date().toLocaleString('en-US', { hour12: false }).replace(/\//g, '-');
  const bundleEventToken = clientBundleToken || ("BND-" + ts.replace(/[^0-9]/g, ''));
  
  let totalValue = 0;
  const originalNames: string[] = [];
  const originalDonors: string[] = [];
  const originalItemTypes: string[] = [];
  const affectedCategories = new Set<string>();
  affectedCategories.add(targetCategory);

  const targetSet = new Set(targetIds.map(id => id.toString()));
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    if (row[ITEM_COL.id] && targetSet.has(row[ITEM_COL.id].toString())) {
      originalNames.push(row[ITEM_COL.name] || "Unknown");
      totalValue += parseFloat((row[ITEM_COL.value] || "0").replace(/[^0-9.-]+/g, "")) || 0;
      if (row[ITEM_COL.donor]) originalDonors.push(row[ITEM_COL.donor]);
      if (row[ITEM_COL.itemType]) originalItemTypes.push(row[ITEM_COL.itemType]);
      
      const origCategory = row[ITEM_COL.category];
      if (origCategory) affectedCategories.add(origCategory);
      
      row[ITEM_COL.id] = ""; row[ITEM_COL.status] = "Inactive"; row[ITEM_COL.bundleId] = bundleEventToken; row[ITEM_COL.bundledDateTime] = ts;
    }
  }

  // 3. Finalize bundle properties
  const parsedValue = value ? parseFloat(value.replace(/[^0-9.-]+/g, "")) : totalValue;
  const finalValueStr = parsedValue > 0 ? `$${parsedValue.toFixed(2)}` : "";
  const cleanOpeningBid = openingBid ? openingBid : (parsedValue > 0 ? `$${(parsedValue * 0.45).toFixed(2)}` : "");
  const cleanMinRaise = minRaise || calculateMinRaise(parsedValue, valueCalculations);
  
  const finalDonor = donor || Array.from(new Set(originalDonors)).join(" / ");
  const finalItemType = itemType || (originalItemTypes.length === 1 ? originalItemTypes[0] : "Both");

  values.push([
    "TEMP", 
    targetCategory, 
    newName, 
    newDescription || "", 
    finalValueStr, 
    cleanOpeningBid, 
    cleanMinRaise, 
    finalDonor, 
    finalItemType, 
    "Active", 
    bundleEventToken, 
    ""
  ]);

  // 4. Re-sequence affected categories
  resequenceCategoryIds(values, affectedCategories, baseNumbers);

  // 5. Commit
  await sheets.spreadsheets.values.update({ 
    spreadsheetId, 
    range: "'Auction-Items'!A1:L", 
    valueInputOption: "USER_ENTERED", 
    requestBody: { values } 
  });

  return {
    action_executed: "BUNDLE_ITEMS",
    ui_history_log: {
      bundle_token: bundleEventToken,
      timestamp: ts,
      bundle_item_name: newName,
      original_item_names: originalNames
    }
  };
}

/**
 * Restores a bundle to its constituent items.
 *
 * Wrapped in withLock - see processBundle's docblock for why.
 */
export async function restoreBundle(
  sheets: sheets_v4.Sheets,
  params: RestoreBundleParams
): Promise<RestoreActionResult> {
  return withLock(`auction-items:${params.spreadsheetId}`, () => restoreBundleLocked(sheets, params));
}

async function restoreBundleLocked(
  sheets: sheets_v4.Sheets,
  params: RestoreBundleParams
): Promise<RestoreActionResult> {
  const { spreadsheetId, targetBundleToken } = params;

  // 1. Fetch Categories and Items
  const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Categories'!A:C" });
  const baseNumbers: Record<string, number> = {};
  (catSearch.data.values || []).slice(1).forEach(row => {
    const catName = (row[0] || "").toString().trim();
    if (catName) baseNumbers[catName] = parseInt(row[1] || row[2] || "0", 10) || getCategoryBase(catName);
  });

  const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const values = dataRes.data.values || [];
  
  const affectedCategories = new Set<string>();
  let bundleRowFound = false;
  
  // 2. Deactivate bundle row
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    if (row[ITEM_COL.bundleId]?.toString() === targetBundleToken?.toString() && row[ITEM_COL.status] === "Active") {
      const cat = row[ITEM_COL.category];
      if (cat) affectedCategories.add(cat);
      row[ITEM_COL.id] = ""; row[ITEM_COL.status] = "Inactive"; row[ITEM_COL.bundleId] = ""; 
      bundleRowFound = true; 
      break; 
    }
  }
  
  if (!bundleRowFound) throw new Error("Active bundle not found");

  // 3. Reactivate original items
  const originalNames: string[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    if (row[ITEM_COL.bundleId]?.toString() === targetBundleToken?.toString() && row[ITEM_COL.status] === "Inactive") {
      const cat = row[ITEM_COL.category];
      if (cat) affectedCategories.add(cat);
      if (row[ITEM_COL.name]) originalNames.push(row[ITEM_COL.name]);
      row[ITEM_COL.status] = "Active"; row[ITEM_COL.bundleId] = ""; row[ITEM_COL.bundledDateTime] = "";       
    }
  }

  // 4. Re-sequence affected categories
  resequenceCategoryIds(values, affectedCategories, baseNumbers);
  
  // 5. Commit
  await sheets.spreadsheets.values.update({ 
    spreadsheetId, 
    range: "'Auction-Items'!A1:L", 
    valueInputOption: "USER_ENTERED", 
    requestBody: { values } 
  });
  
  return {
    success: true,
    ui_history_log: {
      original_item_names: originalNames
    }
  };
}
