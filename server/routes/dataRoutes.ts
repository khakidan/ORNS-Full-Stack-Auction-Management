import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { GoogleGenAI } from '@google/genai';
import { getAuthenticatedClient } from '../utils/auth';
import { performSheetSync } from '../services/syncService';
import { getCategoryBase } from '../utils/categoryHelpers';

export default function createDataRouter(genAI: GoogleGenAI) {
  const router = Router();
  
  // Sheet API Cache
  const sheetCache = new Map<string, { data: any, timestamp: number }>();
  const CACHE_TTL = 5000; // 5 seconds cache

  // Sync bidders via Node.js Google Sheets integration
  router.post("/bidders/sync", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, auctionImportSheetID, auctionTicketSheetsID } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required to sync and setup bid management." });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      console.log(`[Sync Route] Initiating Native Node.js sheet setup for spreadsheet: ${spreadsheetId}...`);
      
      const result = await performSheetSync(client, spreadsheetId, auctionImportSheetID, auctionTicketSheetsID);
      
      res.json({ success: true, result });
    } catch (error: any) {
      console.error(`[Sync Route Error] Native synchronization flow failed:`, error);
      next(error);
    }
  });

  // List Auction Backups
  router.get("/backups/list/:spreadsheetId", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const metadata = await sheets.spreadsheets.get({
        spreadsheetId: req.params.spreadsheetId,
      });

      const backupSheets = metadata.data.sheets?.filter(s => 
        s.properties?.title?.startsWith("Auction-Items Back Up (")
      ).map(s => ({
        title: s.properties?.title,
        sheetId: s.properties?.sheetId,
        index: s.properties?.index
      })) || [];

      res.json(backupSheets);
    } catch (error: any) {
      if (error.code === 404) {
        return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
      }
      next(error);
    }
  });

  // Restore Auction Backup
  router.post("/backups/restore", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, backupSheetName } = req.body;
    if (!spreadsheetId || !backupSheetName) return res.status(400).json({ error: "Missing required parameters" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const metadata = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetsList = metadata.data.sheets || [];
      
      const currentSheet = sheetsList.find(s => s.properties?.title === "Auction-Items");
      const backupSheet = sheetsList.find(s => s.properties?.title === backupSheetName);

      if (!backupSheet) throw new Error("Backup sheet not found");

      const requests: any[] = [];
      const timestamp = new Date().getTime();

      // 1. Rename current to an archive name
      if (currentSheet) {
        requests.push({
          updateSheetProperties: {
            properties: {
              sheetId: currentSheet.properties?.sheetId,
              title: `Auction-Items (Archived ${timestamp})`
            },
            fields: "title"
          }
        });
      }

      // 2. Duplicate backup sheet
      requests.push({
        duplicateSheet: {
          sourceSheetId: backupSheet.properties?.sheetId,
          newSheetName: "Auction-Items",
          insertSheetIndex: 0
        }
      });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      });

      res.json({ success: true });
    } catch (error: any) {
      if (error.code === 404) {
        return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
      }
      next(error);
    }
  });

  router.post("/settings/update", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, key, value, description } = req.body;
    if (!spreadsheetId || !key) return res.status(400).json({ error: "Missing required fields" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // 1. Get all settings
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "_Settings!A:C",
      });

      const rows = result.data.values || [];
      let rowIndex = -1;

      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] === key) {
          rowIndex = i + 1;
          break;
        }
      }

      if (rowIndex !== -1) {
        // 2. Update existing
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `_Settings!B${rowIndex}:C${rowIndex}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[value, description || rows[rowIndex - 1][2] || ""]],
          },
        });
      } else {
        // 3. Append new
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "_Settings!A:C",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[key, value, description || ""]],
          },
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      if (error.code === 404) {
        return res.status(404).json({ error: "Spreadsheet or Settings tab not found. Please check your IDs." });
      }
      next(error);
    }
  });

  // Add Auction Item and resequence
  router.post("/auction/add-item", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, category, name, description, value, openingBid, minRaise, donor, itemType } = req.body;
    if (!spreadsheetId || !category || !name) {
      return res.status(400).json({ error: "Missing required parameters for adding item" });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // 1. Fetch categories for safe resequencing bases
      const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
      const baseNumbers: Record<string, number> = {};
      (catSearch.data.values || []).slice(1).forEach(row => {
        const catName = (row[0] || "").toString().trim();
        const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
        if (catName) {
          baseNumbers[catName] = catBase || getCategoryBase(catName);
        }
      });

      // 2. Fetch the current sheet data
      const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
      const values = dataRes.data.values || [];

      if (values.length === 0) {
        values.push([
          "Auction Item ID", "Category", "Item Name", "Description", "Value", 
          "Opening Bid", "Min Raise Amount", "Donated By", 
          "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"
        ]);
      }

      // 3. Construct and append the new item (temporary ID "TEMP")
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

      // 4. Run Re-Sequencing Cleanup for the affected category to compute and guarantee correct ID
      const rowMapping: {origIndex: number, row: any[]}[] = [];
      for (let i = 1; i < values.length; i++) {
        const r = values[i] || [];
        if (r[1] === category && r[9] === "Active") {
          rowMapping.push({ origIndex: i, row: r });
        }
      }

      rowMapping.sort((a, b) => {
        const idA = a.row[0] === "TEMP" ? 999999 : (parseInt(a.row[0]) || 999999);
        const idB = b.row[0] === "TEMP" ? 999999 : (parseInt(b.row[0]) || 999999);
        if (idA !== idB) return idA - idB;
        return a.origIndex - b.origIndex;
      });

      const startNum = baseNumbers[category] || getCategoryBase(category);
      let runningNum = startNum;
      rowMapping.forEach(item => {
        item.row[0] = runningNum.toString();
        runningNum++;
      });

      // 5. Update the entire sheet range to persist the new row and correct/gap-free IDs
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Auction-Items!A1:L",
        valueInputOption: "USER_ENTERED",
        requestBody: { values }
      });

      // Invalidate cache for this spreadsheet
      for (const key of sheetCache.keys()) {
        if (key.startsWith(`${spreadsheetId}:`)) {
          sheetCache.delete(key);
        }
      }

      const assignedId = newRow[0];
      res.json({ success: true, assigned_id: assignedId, rowIndex: values.length });
    } catch (error: any) {
      console.error("[Server Error] add-item:", error);
      next(error);
    }
  });

  // Delete Auction Item Row
  router.post("/auction/delete-item", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, rowIndex } = req.body;
    if (!spreadsheetId || !rowIndex) {
      return res.status(400).json({ error: "Missing required parameters for deletion" });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // 1. Fetch categories for safe resequencing
      const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
      const baseNumbers: Record<string, number> = {};
      (catSearch.data.values || []).slice(1).forEach(row => {
        const catName = (row[0] || "").toString().trim();
        const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
        if (catName) {
          baseNumbers[catName] = catBase || getCategoryBase(catName);
        }
      });

      // 2. Fetch the current sheet data
      const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
      const values = dataRes.data.values || [];

      // 3. Mark the specified item as deleted
      // Ensure the array reaches the requested rowIndex
      if (!values[rowIndex - 1]) {
        throw new Error(`Row ${rowIndex} not found in the spreadsheet.`);
      }

      const row = values[rowIndex - 1];
      const category = row[1]; // Category is in Column B (index 1)

      // Soft delete: clear ID (Column A) and set status to "Deleted" (Column J)
      row[0] = "";
      row[9] = "Deleted";

      // 4. Run Re-Sequencing Cleanup for the affected category
      if (category) {
        const affectedCategories = new Set<string>();
        affectedCategories.add(category);

        for (const cat of affectedCategories) {
          const rowMapping: {origIndex: number, row: any[]}[] = [];
          for (let i = 1; i < values.length; i++) {
            const r = values[i] || [];
            if (r[1] === r[1] && r[1] === cat && r[9] === "Active") {
              rowMapping.push({ origIndex: i, row: r });
            }
          }
          rowMapping.sort((a, b) => {
            const idA = parseInt(a.row[0]) || 999999;
            const idB = parseInt(b.row[0]) || 999999;
            return idA - idB;
          });
          const startNum = baseNumbers[cat] || getCategoryBase(cat);
          let runningNum = startNum;
          rowMapping.forEach(item => { item.row[0] = runningNum.toString(); runningNum++; });
        }
      }

      // 5. Update the spreadsheet with the modified row and any re-sequenced items
      await sheets.spreadsheets.values.update({
        spreadsheetId, 
        range: "Auction-Items!A1:L", 
        valueInputOption: "USER_ENTERED", 
        requestBody: { values }
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("[Server Error] delete-item:", error);
      next(error);
    }
  });

  // Update Auction Item Row & Manage Sequencing on Change
  router.post("/auction/update-item", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, rowIndex, field, value } = req.body;
    if (!spreadsheetId || !rowIndex || !field) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // 1. Fetch categories for safe resequencing
      const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
      const baseNumbers: Record<string, number> = {};
      (catSearch.data.values || []).slice(1).forEach(row => {
        const catName = (row[0] || "").toString().trim();
        const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
        if (catName) {
          baseNumbers[catName] = catBase || getCategoryBase(catName);
        }
      });

      // 2. Fetch current items
      const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
      const values = dataRes.data.values || [];

      if (!values[rowIndex - 1]) {
        throw new Error(`Row ${rowIndex} not found`);
      }

      const row = values[rowIndex - 1];
      const oldCategory = row[1];

      // Field mapping to index
      const fieldMapping: Record<string, number> = {
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

      const colIdx = fieldMapping[field];
      if (colIdx === undefined) throw new Error(`Invalid field: ${field}`);

      // Update the field
      row[colIdx] = value;

      // Track affected categories for re-sequencing
      const affectedCategories = new Set<string>();
      if (field === 'category') {
        if (oldCategory) affectedCategories.add(oldCategory);
        if (value) affectedCategories.add(value);
      } else if (field === 'status') {
        const category = row[1];
        if (category) affectedCategories.add(category);
      }

      // Run Re-Sequencing Cleanup for affected categories
      for (const cat of affectedCategories) {
        if (!cat) continue;
        const rowMapping: {origIndex: number, row: any[]}[] = [];
        for (let i = 1; i < values.length; i++) {
          const r = values[i] || [];
          if (r[1] === cat && r[9] === "Active") {
            rowMapping.push({ origIndex: i, row: r });
          }
        }
        // Sort them by their original numerical ID or rowIndex if ID is missing / empty
        rowMapping.sort((a, b) => {
          const idA = parseInt(a.row[0]) || 999999;
          const idB = parseInt(b.row[0]) || 999999;
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

      // Update the spreadsheet with the modified rows
      await sheets.spreadsheets.values.update({
        spreadsheetId, 
        range: "Auction-Items!A1:L", 
        valueInputOption: "USER_ENTERED", 
        requestBody: { values }
      });

      res.json({ success: true, affected_categories: Array.from(affectedCategories) });
    } catch (error: any) {
      console.error("[Server Error] update-item:", error);
      next(error);
    }
  });

  // Bulk Update Auction Item Rows & Manage Sequencing on Change
  router.post("/auction/bulk-update-items", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, rowIndices, field, value } = req.body;
    if (!spreadsheetId || !rowIndices || !rowIndices.length || !field) {
      return res.status(400).json({ error: "Missing required bulk update parameters" });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // Fetch categories and base numbers
      const catSearch = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Categories!A:C" });
      const baseNumbers: Record<string, number> = {};
      (catSearch.data.values || []).slice(1).forEach(row => {
        const catName = (row[0] || "").toString().trim();
        const catBase = parseInt(row[1] || row[2] || "0", 10) || 0;
        if (catName) {
          baseNumbers[catName] = catBase || getCategoryBase(catName);
        }
      });

      const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:L" });
      const values = dataRes.data.values || [];

      const fieldMapping: Record<string, number> = {
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

      const colIdx = fieldMapping[field];
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

      // Run Re-Sequencing Cleanup
      for (const cat of affectedCategories) {
        if (!cat) continue;
        const rowMapping: {origIndex: number, row: any[]}[] = [];
        for (let i = 1; i < values.length; i++) {
          const r = values[i] || [];
          if (r[1] === cat && r[9] === "Active") {
            rowMapping.push({ origIndex: i, row: r });
          }
        }
        rowMapping.sort((a, b) => {
          const idA = parseInt(a.row[0]) || 999999;
          const idB = parseInt(b.row[0]) || 999999;
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

      await sheets.spreadsheets.values.update({
        spreadsheetId, 
        range: "Auction-Items!A1:L", 
        valueInputOption: "USER_ENTERED", 
        requestBody: { values }
      });

      res.json({ success: true, affected_categories: Array.from(affectedCategories) });
    } catch (error: any) {
      console.error("[Server Error] bulk-update-items:", error);
      next(error);
    }
  });

  // Sheet API Proxy
  router.get("/sheets/:spreadsheetId/:range", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, range } = req.params;
    const cacheKey = `${spreadsheetId}:${range}`;
    const cached = sheetCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`[Cache Hit] GET ${spreadsheetId} / ${range}`);
      return res.json(cached.data);
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });
      
      // Update cache
      sheetCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
      
      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] GET ${spreadsheetId}:`, error);
      if (error.code === 429) {
        return res.status(429).json({ error: "Google API Quota exceeded. Please wait a moment and try again." });
      }
      if (error.code === 404) {
        return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
      }
      if (error.code === 400 || (error.message && error.message.includes("Unable to parse range"))) {
        return res.status(400).json({ error: error.message, isRangeError: true });
      }
      next(error);
    }
  });

  router.post("/sheets/:spreadsheetId/:range", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { spreadsheetId, range } = req.params;
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: req.body.values,
        },
      });
      
      // Invalidate cache for this sheet/range
      const cacheKey = `${spreadsheetId}:${range}`;
      sheetCache.delete(cacheKey);
      // Also invalidate any overlapping ranges (simplest is to clear all for this sheet)
      for (const key of sheetCache.keys()) {
        if (key.startsWith(`${spreadsheetId}:`)) {
          sheetCache.delete(key);
        }
      }

      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] POST ${req.params.spreadsheetId}:`, error);
      if (error.code === 404) {
        return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
      }
      next(error);
    }
  });

  router.post("/sheets/:spreadsheetId/:range/append", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { spreadsheetId, range } = req.params;
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: req.body.values,
        },
      });

      // Invalidate cache for this sheet
      for (const key of sheetCache.keys()) {
        if (key.startsWith(`${spreadsheetId}:`)) {
          sheetCache.delete(key);
        }
      }

      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] APPEND ${req.params.spreadsheetId}:`, error);
      if (error.code === 404) {
        return res.status(404).json({ error: "Spreadsheet not found. Please check the Spreadsheet ID in Settings." });
      }
      next(error);
    }
  });

  router.post("/sheets/:spreadsheetId/:range/clear", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { spreadsheetId, range } = req.params;
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range,
      });

      // Invalidate cache for this sheet
      for (const key of sheetCache.keys()) {
        if (key.startsWith(`${spreadsheetId}:`)) {
          sheetCache.delete(key);
        }
      }

      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] CLEAR ${req.params.spreadsheetId}:`, error);
      next(error);
    }
  });

  // Drive API Proxy
  router.get("/drive/files/:folderId", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const drive = google.drive({ version: "v3", auth: client });

      console.log(`[Drive API] Cached Scopes: ${req.session.tokens.scope}`);
      console.log(`[Drive API] Fetching files for folderId: ${req.params.folderId}`);
      
      if (!req.params.folderId || req.params.folderId === "undefined" || req.params.folderId === "null" || req.params.folderId === "") {
        return res.json([]);
      }

      const query = `'${req.params.folderId}' in parents and trashed = false`;
      console.log(`[Drive API] Query: ${query}`);

      const result = await drive.files.list({
        q: query,
        fields: "files(id, name, webViewLink, iconLink, modifiedTime)",
        orderBy: "modifiedTime desc",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: "allDrives",
      });
      
      console.log(`[Drive API] Found ${result.data.files?.length || 0} files`);
      res.json(result.data.files || []);
    } catch (error: any) {
      console.error(`[Drive API] Error fetching files:`, error);
      if (error.code === 404) {
        return res.status(404).json({ error: "Folder not found. Please check the folder ID in Settings." });
      }
      next(error);
    }
  });

  router.get("/drive/download/:fileId", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const drive = google.drive({ version: "v3", auth: client });
      const fileId = req.params.fileId;

      const metadata = await drive.files.get({ 
        fileId, 
        fields: "id, name, mimeType",
        supportsAllDrives: true
      });
      
      const fileName = metadata.data.name || "receipt";
      const mimeType = metadata.data.mimeType;

      console.log(`[Drive API] Downloading ${fileId} (${fileName}) - MimeType: ${mimeType}`);

      if (mimeType === "application/vnd.google-apps.document") {
        console.log(`[Drive API] Exporting Workspace doc as PDF`);
        const response = await drive.files.export(
          { fileId, mimeType: "application/pdf" },
          { responseType: "stream" }
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}.pdf"`);
        response.data.pipe(res);
      } else {
        console.log(`[Drive API] Fetching binary content`);
        const response = await drive.files.get(
          { fileId, alt: "media", supportsAllDrives: true },
          { responseType: "stream" }
        );
        
        res.setHeader("Content-Type", mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        response.data.pipe(res);
      }

      console.log(`[Drive API] Download started for ${fileId}`);
    } catch (error: any) {
      console.error(`[Drive API] Download failure:`, error);
      next(error);
    }
  });

  // Gemini Assistant Endpoint
  router.post("/assistant", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured in the environment." });
    }

    const { context, message, history } = req.body;
    if (!message) {
      return res.status(400).json({ error: "No message provided" });
    }

    try {
      const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
      
      const mappedContext = recentHistory.map((msg: any) => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
      }));

      mappedContext.push({
        role: 'user',
        parts: [{ text: message }]
      });

      const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

      const result = await genAI.models.generateContent({
        model: modelName,
        contents: mappedContext,
        config: {
          systemInstruction: context || "You are an AI assistant for a charity auction.",
        }
      });

      const finishReason = result.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        return res.status(503).json({ error: "AI generation interrupted", fallback: true });
      }

      res.json({ text: result.text });
    } catch (error: any) {
      console.error("Gemini assistant error:", error);
      res.status(500).json({ error: error.message, fallback: true });
    }
  });

  return router;
}
