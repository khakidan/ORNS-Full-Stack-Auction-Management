import { Router, Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission';
import { sheetsFor } from '../utils/googleClients';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { IDEMPOTENT_POST_RETRY } from '../utils/googleRetry';

/** The Auction Tickets spreadsheet's attendee tabs. */
export const TICKET_SHEETS = ["tickets", "staff tickets", "sponsor tickets"];

/** Attendee List changes that need their own permission check. */
export default function createAttendeeRouter() {
  const router = Router();

  /**
   * Deletes an attendee by clearing their row (the same thing the
   * Attendee List did through the generic sheets proxy, which now refuses
   * the ticket tabs so this permission can't be bypassed).
   */
  router.post("/attendees/delete", requirePermission("attendees.delete"), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, sheet, rowIndex } = req.body || {};
    if (!spreadsheetId || !TICKET_SHEETS.includes(sheet) || !Number.isInteger(rowIndex) || rowIndex < 2) {
      return res.status(400).json({ error: "spreadsheetId, a ticket sheet name and a data row number are required." });
    }
    try {
      await sheetsFor(req).spreadsheets.values.clear({
        spreadsheetId,
        range: `'${sheet}'!A${rowIndex}:Z${rowIndex}`,
      }, IDEMPOTENT_POST_RETRY);
      clearCacheForSpreadsheet(spreadsheetId);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
