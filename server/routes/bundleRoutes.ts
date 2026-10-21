import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import {
  suggestBundleNames,
  suggestBundleDescription,
  processBundle,
  restoreBundle
} from '../services/bundleService';
import { requireAuth } from '../middleware/requireAuth';

export default function createBundleRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post("/suggest-names", async (req: Request, res: Response, next: NextFunction) => {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    try {
      const result = await suggestBundleNames({ items });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/suggest-description", async (req: Request, res: Response, next: NextFunction) => {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    try {
      const result = await suggestBundleDescription({ items });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/process", async (req: Request, res: Response, next: NextFunction) => {
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
      bundleEventToken, 
      timestamp, 
      idempotencyKey 
    } = req.body;

    if (!spreadsheetId || !targetIds || !targetIds.length || !newName || !targetCategory) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const outcome = await withIdempotency("bundle/process", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        const result = await processBundle(sheets, {
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
          bundleEventToken,
          timestamp
        });

        clearCacheForSpreadsheet(spreadsheetId);
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      next(error);
    }
  });

  router.post("/restore", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, targetBundleToken, idempotencyKey } = req.body;
    
    if (!spreadsheetId || !targetBundleToken) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const outcome = await withIdempotency("bundle/restore", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        const result = await restoreBundle(sheets, {
          spreadsheetId,
          targetBundleToken
        });

        clearCacheForSpreadsheet(spreadsheetId);
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      if (error.message.includes("Active bundle not found")) {
        return res.status(404).json({ error: error.message });
      }
      next(error);
    }
  });

  return router;
}

