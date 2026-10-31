import { Router, Request, Response, NextFunction } from 'express';
import { fromConfig, ITEM_FIELDS } from '../middleware/fromConfig';
import { logAction } from '../services/actionLog';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import {
  suggestBundleNames,
  suggestBundleDescription,
  processBundle,
  restoreBundle
} from '../services/bundleService';
import { requireAuth } from '../middleware/requireAuth';
import { refuseStandardItemChange } from '../services/standardItems';
import { sheetsFor } from '../utils/googleClients';
import type { BundleProcessRequest, BundleRestoreRequest, BundleSuggestRequest } from "../../shared/apiTypes";

export default function createBundleRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post("/suggest-names", async (req: Request, res: Response, next: NextFunction) => {
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY not configured" });

    const { items } = req.body as BundleSuggestRequest;
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

    const { items } = req.body as BundleSuggestRequest;
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

  router.post("/process", fromConfig(ITEM_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
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
    } = req.body as BundleProcessRequest;

    if (!spreadsheetId || !targetIds || !targetIds.length || !newName || !targetCategory) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const refusal = await refuseStandardItemChange(req, spreadsheetId, { ids: targetIds });
      if (refusal) return res.status(403).json({ error: refusal });
      const outcome = await withIdempotency("bundle/process", idempotencyKey, async () => {
        const sheets = sheetsFor(req);

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
        const log = result.ui_history_log;
        await logAction(req, {
          area: "Auction Items",
          action: "Bundle items",
          target: log.bundle_item_name,
          summary: `Bundled ${log.original_item_names.length} item(s) into "${log.bundle_item_name}": ${log.original_item_names.join(", ")}`,
          after: { bundleId: log.bundle_token, items: log.original_item_names },
          location: "Auction Items 'Auction-Items'",
          undo: { kind: "bundle", spreadsheetId, bundleToken: log.bundle_token, bundleName: log.bundle_item_name },
        });
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      next(error);
    }
  });

  router.post("/restore", fromConfig(ITEM_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, targetBundleToken, idempotencyKey } = req.body as BundleRestoreRequest;
    
    if (!spreadsheetId || !targetBundleToken) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const outcome = await withIdempotency("bundle/restore", idempotencyKey, async () => {
        const sheets = sheetsFor(req);

        const result = await restoreBundle(sheets, {
          spreadsheetId,
          targetBundleToken
        });

        clearCacheForSpreadsheet(spreadsheetId);
        await logAction(req, {
          area: "Auction Items",
          action: "Restore bundle",
          target: targetBundleToken,
          summary: `Split bundle ${targetBundleToken} back into its original items`,
          notUndoableReason: "re-bundle the items instead",
        });
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

