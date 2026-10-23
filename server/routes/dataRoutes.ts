import { Router, Request, Response, NextFunction } from 'express';
import { IDEMPOTENT_POST_RETRY } from '../utils/googleRetry';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { performSheetSync } from '../services/syncService';
import { sheetCache, CACHE_TTL, clearCacheForSpreadsheet, sheetCacheKey } from '../utils/sheetCache';
import { normalizeRange } from '../utils/rangeUtils';
import {
  addItem,
  deleteItem,
  updateItem,
  bulkUpdateItems,
  ItemChangedError
} from '../services/itemService';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { requireAuth } from '../middleware/requireAuth';
import { withLock } from '../utils/asyncLock';
import { getSweeperStatus, runPaypalSweep } from '../services/paypalSweeperJob';

export default function createDataRouter() {
  const router = Router();
  router.use(requireAuth);

  // Sheet API Cache is now imported from shared utils/sheetCache

  // The generic write/append/clear passthrough below takes no lock, so it
  // refuses the tabs that have their own locked routes (patterns.md's
  // locking rule): writing them here could land between a locked
  // read-modify-write and be lost, or overwrite it. Matched by the default
  // tab names; the app itself never sends these here.
  const LOCKED_SHEETS = new Set(["auction-items", "bidder-numbers", "bid-management", "special-winners", "follow-up", "paypal-follow-up"]);
  const refuseLockedSheet = (range: string, res: Response): boolean => {
    const sheetName = range.split("!")[0].trim().replace(/^'(.*)'$/, "$1").trim().toLowerCase();
    if (!LOCKED_SHEETS.has(sheetName)) return false;
    res.status(403).json({ error: `The ${range.split("!")[0]} sheet can only be changed through the app's own save actions.` });
    return true;
  };

  // Sync bidders via Node.js Google Sheets integration
  router.post("/bidders/sync", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, auctionTicketSheetsID } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required to sync and setup bid management." });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      console.log(`[Sync Route] Initiating Native Node.js sheet setup for spreadsheet: ${spreadsheetId}...`);

      const result = await performSheetSync(client, spreadsheetId, auctionTicketSheetsID);

      res.json({ success: true, result });
    } catch (error: any) {
      console.error(`[Sync Route Error] Native synchronization flow failed:`, error);
      // Surface expected, actionable failures (missing settings, the
      // already-registered-walk-in guard) with their real message intact -
      // the generic errorHandler's {error: "Internal Server Error"} shape
      // would otherwise swallow it, since the frontend reads `result.error`.
      if (error.message.includes("Cannot re-sync") || error.message.includes("Missing '")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Status for the Configuration page's PayPal sweeper card - surfaces
  // the two manual-only steps from Code Hardening item #2 (an admin
  // signing in once to store a background-sync credential, and the
  // Node job actually running reliably) so they're visible from inside
  // the app instead of only inferable from server logs. See
  // docs/agents/refactor-opportunities.md.
  router.get("/paypal-sweeper/status", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = await getSweeperStatus();
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  // Lets an admin trigger an immediate sweep from the Configuration page
  // rather than waiting up to the full interval to confirm it's working.
  router.post("/paypal-sweeper/run-now", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await runPaypalSweep();
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/settings/update", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, key, value, description, idempotencyKey } = req.body;
    if (!spreadsheetId || !key) return res.status(400).json({ error: "Missing required fields" });

    // Found in a hardening audit (docs/agents/refactor-opportunities.md's
    // Code Hardening item #1 / CHANGELOG.md): this route had neither
    // withLock nor an idempotency key, unlike sibling mutating routes -
    // low likelihood given Settings is normally single-admin, but it does
    // the same unsafe shape as everything else here (read the full
    // '_Settings'!A:C range to find a key's row, then write back to it) so
    // it gets the same protection for consistency's sake. A distinct lock
    // key from `auction-items:*`/`bidder-numbers:*` - a different sheet
    // entirely.
    try {
      const outcome = await withIdempotency("settings/update", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        await withLock(`settings:${spreadsheetId}`, async () => {
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
        });

        return { success: true };
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      if (error.code === 404) {
        return res.status(404).json({ error: "Spreadsheet or Settings tab not found. Please check your IDs." });
      }
      next(error);
    }
  });

  // Add Auction Item and resequence
  router.post("/auction/add-item", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, category, name, description, value, donor, itemType, allowMultipleWinners, idempotencyKey } = req.body;
    if (!spreadsheetId || !category || !name) {
      return res.status(400).json({ error: "Missing required parameters for adding item" });
    }

    try {
      const outcome = await withIdempotency("auction/add-item", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        return addItem(sheets, {
          spreadsheetId,
          category,
          name,
          description,
          value,
          donor,
          itemType,
          allowMultipleWinners: !!allowMultipleWinners
        });
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Server Error] add-item:", error);
      next(error);
    }
  });

  // Delete Auction Item Row
  router.post("/auction/delete-item", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, rowIndex, idempotencyKey } = req.body;
    if (!spreadsheetId || !rowIndex) {
      return res.status(400).json({ error: "Missing required parameters for deletion" });
    }

    // Found in a hardening audit (docs/agents/refactor-opportunities.md's
    // Code Hardening item #1 / CHANGELOG.md): this route had no
    // idempotencyKey, unlike its add-item/bulk-update-items siblings -
    // closing the inconsistency (low real risk on its own, since
    // re-deleting an already-blanked row is a no-op, but a retried
    // duplicate should still short-circuit like every other mutating
    // route here does).
    try {
      const outcome = await withIdempotency("auction/delete-item", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        const result = await deleteItem(sheets, {
          spreadsheetId,
          rowIndex
        });

        clearCacheForSpreadsheet(spreadsheetId);
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Server Error] delete-item:", error);
      next(error);
    }
  });

  // Save one item's changed fields (locked) & resequence IDs on a category/status change
  router.post("/auction/update-item", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, rowIndex, changes, expectedName } = req.body;
    if (!spreadsheetId || !Number.isInteger(rowIndex) || !changes || typeof changes !== "object" || Array.isArray(changes)) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    if (expectedName !== undefined && typeof expectedName !== "string") {
      return res.status(400).json({ error: "expectedName must be text" });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await updateItem(sheets, { spreadsheetId, rowIndex, changes, expectedName });

      res.json(result);
    } catch (error: any) {
      console.error("[Server Error] update-item:", error);
      if (error instanceof ItemChangedError) {
        return res.status(409).json({ error: error.message });
      }
      if (error.message?.includes("Invalid field") || /^Row \d+ not found$/.test(error.message || "")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Bulk Update Auction Item Rows & Manage Sequencing on Change
  router.post("/auction/bulk-update-items", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, rowIndices, field, value, idempotencyKey } = req.body;
    if (!spreadsheetId || !rowIndices || !rowIndices.length || !field) {
      return res.status(400).json({ error: "Missing required bulk update parameters" });
    }

    try {
      const outcome = await withIdempotency("auction/bulk-update-items", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        return bulkUpdateItems(sheets, {
          spreadsheetId,
          rowIndices,
          field,
          value
        });
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Server Error] bulk-update-items:", error);
      next(error);
    }
  });

  // Sheet API Proxy
  router.get("/sheets/:spreadsheetId/:range", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, range } = req.params;
    const decodedRange = decodeURIComponent(range);
    const normalizedRange = normalizeRange(decodedRange);
    const cacheKey = sheetCacheKey(spreadsheetId, req.session?.tokens, normalizedRange);
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
    if (!req.body || !req.body.values) {
      return res.status(400).json({ error: "Missing body values" });
    }

    try {
      const { spreadsheetId, range } = req.params;
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const decodedRange = decodeURIComponent(range);
      if (refuseLockedSheet(decodedRange, res)) return;
      const normalizedRange = normalizeRange(decodedRange);

      const result = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: normalizedRange,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: req.body.values,
        },
      });
      
      clearCacheForSpreadsheet(spreadsheetId);

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
    if (!req.body || !req.body.values) {
      return res.status(400).json({ error: "Missing body values" });
    }

    try {
      const { spreadsheetId, range } = req.params;
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const decodedRange = decodeURIComponent(range);
      if (refuseLockedSheet(decodedRange, res)) return;
      const normalizedRange = normalizeRange(decodedRange);

      const result = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: normalizedRange,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: req.body.values,
        },
      });

      clearCacheForSpreadsheet(spreadsheetId);

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
    try {
      const { spreadsheetId, range } = req.params;
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const decodedRange = decodeURIComponent(range);
      if (refuseLockedSheet(decodedRange, res)) return;
      const normalizedRange = normalizeRange(decodedRange);

      const result = await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: normalizedRange,
      }, IDEMPOTENT_POST_RETRY);

      clearCacheForSpreadsheet(spreadsheetId);

      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] CLEAR ${req.params.spreadsheetId}:`, error);
      next(error);
    }
  });

  // Drive API Proxy
  router.get("/drive/files/:folderId", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const drive = google.drive({ version: "v3", auth: client });

      console.log(`[Drive API] Fetching files for folderId: ${req.params.folderId}`);
      
      if (!req.params.folderId || req.params.folderId === "undefined" || req.params.folderId === "null" || req.params.folderId === "") {
        return res.json([]);
      }
      // Drive IDs are only letters, digits, - and _. Anything else would be
      // spliced into the `q` query below as query syntax (ROADMAP.md L7).
      if (!/^[A-Za-z0-9_-]+$/.test(req.params.folderId)) {
        return res.status(400).json({ error: "That isn't a valid Drive folder ID. Please check the folder ID in Settings." });
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

  return router;
}
