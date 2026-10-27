import { Router, Request, Response, NextFunction } from 'express';
import { IDEMPOTENT_POST_RETRY } from '../utils/googleRetry';
import { sheetCache, CACHE_TTL, clearCacheForSpreadsheet, sheetCacheKey } from '../utils/sheetCache';
import { normalizeRange } from '../utils/rangeUtils';
import { sheetsFor, respondIfNotFound } from '../utils/googleClients';
import { TICKET_SHEETS } from './attendeeRoutes';

// The write/append/clear passthrough takes no lock, so it refuses the tabs
// that have their own locked routes (patterns.md's locking rule): writing
// them here could land between a locked read-modify-write and be lost, or
// overwrite it. Matched by the default tab names; the app itself never
// sends these here.
const LOCKED_SHEETS = new Set(["auction-items", "bidder-numbers", "bid-management", "special-winners", "follow-up", "paypal-follow-up"]);

function sheetNameOf(range: string): string {
  return range.split("!")[0].trim().replace(/^'(.*)'$/, "$1").trim().toLowerCase();
}

function refuseLockedSheet(range: string, res: Response): boolean {
  const sheetName = sheetNameOf(range);
  if (!LOCKED_SHEETS.has(sheetName)) return false;
  res.status(403).json({ error: `The ${range.split("!")[0]} sheet can only be changed through the app's own save actions.` });
  return true;
}

/** Generic Sheets read (cached per user) and write/append/clear for sheets without their own routes. */
export default function createSheetsProxyRouter() {
  const router = Router();

  router.get("/sheets/:spreadsheetId/:range", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, range } = req.params;
    const normalizedRange = normalizeRange(decodeURIComponent(range));
    const cacheKey = sheetCacheKey(spreadsheetId, req.session?.tokens, normalizedRange);
    const cached = sheetCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return res.json(cached.data);
    }

    try {
      const result = await sheetsFor(req).spreadsheets.values.get({ spreadsheetId, range: normalizedRange });
      sheetCache.set(cacheKey, { data: result.data, timestamp: Date.now() });
      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] GET ${spreadsheetId}:`, error);
      if (error.code === 429) {
        return res.status(429).json({ error: "Google API Quota exceeded. Please wait a moment and try again." });
      }
      if (respondIfNotFound(error, res)) return;
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
      const decodedRange = decodeURIComponent(range);
      if (refuseLockedSheet(decodedRange, res)) return;

      const result = await sheetsFor(req).spreadsheets.values.update({
        spreadsheetId,
        range: normalizeRange(decodedRange),
        valueInputOption: "USER_ENTERED",
        requestBody: { values: req.body.values },
      });
      clearCacheForSpreadsheet(spreadsheetId);
      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] POST ${req.params.spreadsheetId}:`, error);
      if (respondIfNotFound(error, res)) return;
      next(error);
    }
  });

  router.post("/sheets/:spreadsheetId/:range/append", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.body || !req.body.values) {
      return res.status(400).json({ error: "Missing body values" });
    }

    try {
      const { spreadsheetId, range } = req.params;
      const decodedRange = decodeURIComponent(range);
      if (refuseLockedSheet(decodedRange, res)) return;

      const result = await sheetsFor(req).spreadsheets.values.append({
        spreadsheetId,
        range: normalizeRange(decodedRange),
        valueInputOption: "USER_ENTERED",
        requestBody: { values: req.body.values },
      });
      clearCacheForSpreadsheet(spreadsheetId);
      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] APPEND ${req.params.spreadsheetId}:`, error);
      if (respondIfNotFound(error, res)) return;
      next(error);
    }
  });

  router.post("/sheets/:spreadsheetId/:range/clear", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { spreadsheetId, range } = req.params;
      const decodedRange = decodeURIComponent(range);
      if (refuseLockedSheet(decodedRange, res)) return;
      // Clearing an attendee row is deleting the attendee, which needs a
      // permission check - that goes through POST /api/attendees/delete.
      if (TICKET_SHEETS.includes(sheetNameOf(decodedRange))) {
        res.status(403).json({ error: "Attendees can only be deleted through the Attendee List." });
        return;
      }

      const result = await sheetsFor(req).spreadsheets.values.clear({
        spreadsheetId,
        range: normalizeRange(decodedRange),
      }, IDEMPOTENT_POST_RETRY);
      clearCacheForSpreadsheet(spreadsheetId);
      res.json(result.data);
    } catch (error: any) {
      console.error(`[Sheets API Error] CLEAR ${req.params.spreadsheetId}:`, error);
      next(error);
    }
  });

  return router;
}
