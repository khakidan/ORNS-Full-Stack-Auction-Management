import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { performSheetSync } from '../services/syncService';
import { sheetCache, CACHE_TTL, clearCacheForSpreadsheet } from '../utils/sheetCache';
import { normalizeRange } from '../utils/rangeUtils';
import { genAI } from '../services/genai';
import { 
  addItem, 
  deleteItem, 
  updateItem, 
  bulkUpdateItems,
  ensureFollowUpSheet
} from '../services/itemService';
import { listBackups, restoreBackup } from '../services/backupService';
import { handleAssistantRequest } from '../services/assistantService';
import { checkIdempotency, saveIdempotency } from '../utils/idempotency';

export default function createDataRouter() {
  const router = Router();
  
  // Sheet API Cache is now imported from shared utils/sheetCache

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
      const result = await listBackups(sheets, req.params.spreadsheetId);
      res.json(result);
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
      const result = await restoreBackup(sheets, spreadsheetId, backupSheetName);
      res.json(result);
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

    const { spreadsheetId, category, name, description, value, donor, itemType, idempotencyKey } = req.body;
    if (!spreadsheetId || !category || !name) {
      return res.status(400).json({ error: "Missing required parameters for adding item" });
    }

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await addItem(sheets, {
        spreadsheetId,
        category,
        name,
        description,
        value,
        donor,
        itemType
      });

      saveIdempotency(idempotencyKey, result);
      res.json(result);
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

      const result = await deleteItem(sheets, {
        spreadsheetId,
        rowIndex
      });

      res.json(result);
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

      const result = await updateItem(sheets, {
        spreadsheetId,
        rowIndex,
        field,
        value
      });

      res.json(result);
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

      const result = await bulkUpdateItems(sheets, {
        spreadsheetId,
        rowIndices,
        field,
        value
      });

      res.json(result);
    } catch (error: any) {
      console.error("[Server Error] bulk-update-items:", error);
      next(error);
    }
  });

  // Sheet API Proxy
  router.get("/sheets/:spreadsheetId/:range", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, range } = req.params;
    const decodedRange = decodeURIComponent(range);
    const normalizedRange = normalizeRange(decodedRange);
    const cacheKey = `${spreadsheetId}:${normalizedRange}`;
    const cached = sheetCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log(`[Cache Hit] GET ${spreadsheetId} / ${normalizedRange}`);
      return res.json(cached.data);
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: normalizedRange,
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

      const decodedRange = decodeURIComponent(range);
      const normalizedRange = normalizeRange(decodedRange);
      const sheetName = decodedRange.split('!')[0];
      
      await ensureFollowUpSheet(sheets, spreadsheetId, sheetName);

      const result = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: normalizedRange,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: req.body.values,
        },
      });
      
      // Invalidate cache for this sheet/range
      const cacheKey = `${spreadsheetId}:${normalizedRange}`;
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

      const decodedRange = decodeURIComponent(range);
      const normalizedRange = normalizeRange(decodedRange);
      const sheetName = decodedRange.split('!')[0];

      await ensureFollowUpSheet(sheets, spreadsheetId, sheetName);
      
      const result = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: normalizedRange,
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

      const decodedRange = decodeURIComponent(range);
      const normalizedRange = normalizeRange(decodedRange);

      const result = await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: normalizedRange,
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
      const text = await handleAssistantRequest(context, message, history);
      res.json({ text });
    } catch (error: any) {
      console.error("Gemini assistant error:", error);
      res.status(500).json({ error: error.message, fallback: true });
    }
  });

  return router;
}
