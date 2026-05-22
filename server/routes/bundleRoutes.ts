import { Router } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../utils/auth';
import { getCategoryBase } from '../utils/categoryHelpers';
import { checkIdempotency, saveIdempotency } from '../utils/idempotency';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { genAI } from '../services/genai';

export default function createBundleRouter() {
  const router = Router();

  router.post("/suggest-names", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "No items provided" });

    try {
      const itemsDescription = items.map((it: any) => `- ${it.name}: ${it.description || 'No description'}`).join('\n');
      const prompt = `Suggested names for bundle: ${itemsDescription}`;
      const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
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
      res.json({ suggestions: JSON.parse(rawText.replace(/^```json\n?/, "").replace(/\n?```$/, "")) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/suggest-description", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "No items provided" });

    try {
      const itemsList = items.map((it: any) => `- ${it.name}: ${it.description || 'No description'}`).join('\n');
      const prompt = `Write a professional, catchy, and appealing auction description for a bundle containing these items:\n${itemsList}\n\nThe description MUST be exactly one paragraph long, professional yet exciting for a school fundraiser. Don't use placeholders. Focus on the value and experience of the bundle.`;
      
      const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const result = await genAI.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: "You are an expert at writing compelling silent auction descriptions. Return a plain text description that is exactly one paragraph long.",
        }
      });
      res.json({ description: result.text });
    } catch (error) {
      next(error);
    }
  });

  router.post("/process", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

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
      timestamp, 
      idempotencyKey 
    } = req.body;

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    if (!spreadsheetId || !targetIds || !targetIds.length || !newName || !targetCategory) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const metadata = await sheets.spreadsheets.get({ spreadsheetId });
      if (!metadata.data.sheets?.find(s => s.properties?.title === "Auction-Items")) throw new Error("Target sheet 'Auction-Items' not found");

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

      const targetSet = new Set(targetIds.map((id: string) => id.toString()));
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        if (row[0] && targetSet.has(row[0].toString())) {
          originalNames.push(row[2] || "Unknown");
          totalValue += parseFloat((row[4] || "0").replace(/[^0-9.-]+/g, "")) || 0;
          if (row[7]) originalDonors.push(row[7]);
          if (row[8]) originalItemTypes.push(row[8]);
          
          const origCategory = row[1];
          if (origCategory) affectedCategories.add(origCategory);
          
          row[0] = ""; row[9] = "Inactive"; row[10] = bundleEventToken; row[11] = ts;
        }
      }

      // Calculate or clean values
      const parsedValue = value ? parseFloat(value.replace(/[^0-9.-]+/g, "")) : totalValue;
      const finalValueStr = parsedValue > 0 ? `$${parsedValue.toFixed(2)}` : "";
      
      const cleanOpeningBid = openingBid ? openingBid : (parsedValue > 0 ? `$${(parsedValue * 0.45).toFixed(2)}` : "");
      
      // Enforce calculating minimum raise based purely on the new total value and established rules
      let cleanMinRaise = "";
      if (parsedValue > 0) {
        let calculatedRaise = 5;
        if (valueCalculations.length > 0) {
          const sorted = [...valueCalculations].sort((a, b) => a.minRange - b.minRange);
          for (const tier of sorted) {
            if (parsedValue >= tier.minRange) {
              calculatedRaise = tier.minRaise;
            }
          }
        } else {
          if (parsedValue < 150) calculatedRaise = 5;
          else if (parsedValue < 300) calculatedRaise = 10;
          else if (parsedValue < 450) calculatedRaise = 15;
          else if (parsedValue < 600) calculatedRaise = 20;
          else if (parsedValue < 750) calculatedRaise = 30;
          else if (parsedValue < 900) calculatedRaise = 40;
          else calculatedRaise = 50;
        }
        cleanMinRaise = `$${calculatedRaise.toFixed(2)}`;
      }

      // If cleanMinRaise is not set or if there's any fallback required, ensure we default to $5.00
      if (!cleanMinRaise) {
        cleanMinRaise = "$5.00";
      }

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

      // Run Re-Sequencing Cleanup for the affected categories to compute and guarantee gap-free IDs
      for (const cat of affectedCategories) {
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

      await sheets.spreadsheets.values.update({ spreadsheetId, range: "'Auction-Items'!A1:L", valueInputOption: "USER_ENTERED", requestBody: { values } });
      clearCacheForSpreadsheet(spreadsheetId);

      const responsePayload = { action_executed: "BUNDLE_ITEMS", ui_history_log: { bundle_token: bundleEventToken, timestamp: ts, bundle_item_name: newName, original_item_names: originalNames } };
      saveIdempotency(idempotencyKey, responsePayload);
      res.json(responsePayload);
    } catch (error) {
      next(error);
    }
  });

  router.post("/restore", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, targetBundleToken, idempotencyKey } = req.body;
    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    if (!spreadsheetId || !targetBundleToken) return res.status(400).json({ error: "Missing required parameters" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

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
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        if (row[10]?.toString() === targetBundleToken?.toString() && row[9] === "Active") {
          const cat = row[1];
          if (cat) affectedCategories.add(cat);
          row[0] = ""; row[9] = "Inactive"; row[10] = ""; bundleRowFound = true; break; 
        }
      }
      if (!bundleRowFound) return res.status(404).json({ error: "Active bundle not found" });

      const originalNames: string[] = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        if (row[10]?.toString() === targetBundleToken?.toString() && row[9] === "Inactive") {
          const cat = row[1];
          if (cat) affectedCategories.add(cat);
          if (row[2]) originalNames.push(row[2]);
          row[9] = "Active"; row[10] = ""; row[11] = "";       
        }
      }

      // Run Re-Sequencing Cleanup for the affected categories to compute and guarantee gap-free IDs
      for (const cat of affectedCategories) {
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
      
      await sheets.spreadsheets.values.update({ spreadsheetId, range: "'Auction-Items'!A1:L", valueInputOption: "USER_ENTERED", requestBody: { values } });
      clearCacheForSpreadsheet(spreadsheetId);
      
      const responsePayload = {
        success: true,
        ui_history_log: {
          original_item_names: originalNames
        }
      };
      saveIdempotency(idempotencyKey, responsePayload);
      res.json(responsePayload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
