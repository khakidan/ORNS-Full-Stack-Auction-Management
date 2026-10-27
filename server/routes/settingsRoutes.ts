import { Router, Request, Response, NextFunction } from 'express';
import { logAction } from '../services/actionLog';
import { requirePermission } from '../middleware/requirePermission';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { sheetsFor, respondIfNotFound } from '../utils/googleClients';
import { upsertSetting } from '../services/settingsService';

/** Saves one `_Settings` key (settingsService.ts). */
export default function createSettingsRouter() {
  const router = Router();

  router.post("/settings/update", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, key, value, description, idempotencyKey } = req.body;
    if (!spreadsheetId || !key) return res.status(400).json({ error: "Missing required fields" });

    try {
      const outcome = await withIdempotency("settings/update", idempotencyKey, async () => {
        await upsertSetting(sheetsFor(req), { spreadsheetId, key, value, description });
        await logAction(req, { area: "Settings", action: "Save setting", target: key, summary: `Saved setting ${key}`, after: value, notUndoableReason: "save the setting again to change it" });
        return { success: true };
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      if (respondIfNotFound(error, res, "Spreadsheet or Settings tab not found. Please check your IDs.")) return;
      next(error);
    }
  });

  return router;
}
