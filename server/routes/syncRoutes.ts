import { Router, Request, Response, NextFunction } from 'express';
import { logAction } from '../services/actionLog';
import { requirePermission } from '../middleware/requirePermission';
import { sheetsFor, respondIfNotFound } from '../utils/googleClients';
import { performSheetSync, isBidManagementSetUp } from '../services/syncService';
import { AlreadyRunningError, runIfIdle } from '../utils/asyncLock';

/** Builds Bidder-Numbers / Bid-Management from the ticket sheets (syncService.ts). */
export default function createSyncRouter() {
  const router = Router();

  router.post("/bidders/sync", requirePermission("auction.stage"), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, auctionTicketSheetsID } = req.body;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required to sync and setup bid management." });
    }

    try {
      // One Set Up at a time: a double-click would otherwise rebuild twice.
      const result = await runIfIdle(`bidders-sync:${spreadsheetId}`, () => performSheetSync(sheetsFor(req), spreadsheetId, auctionTicketSheetsID));
      await logAction(req, {
        area: "Bid Management",
        action: "Set Up Bid Management App",
        summary: "Rebuilt Bidder-Numbers and the bid sheet from the ticket spreadsheet (the previous tabs were kept as backups)",
        notUndoableReason: "the previous tabs were kept as renamed backups in the spreadsheet",
      });
      res.json({ success: true, result });
    } catch (error: any) {
      if (error instanceof AlreadyRunningError) return res.status(409).json({ error: "Set Up is already running. Wait for it to finish." });
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

  router.get("/bidders/setup-status", async (req: Request, res: Response, next: NextFunction) => {
    const spreadsheetId = req.query.spreadsheetId;
    if (typeof spreadsheetId !== "string" || !spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required." });
    }
    try {
      res.json({ setUp: await isBidManagementSetUp(sheetsFor(req), spreadsheetId) });
    } catch (error: any) {
      if (respondIfNotFound(error, res)) return;
      next(error);
    }
  });

  return router;
}
