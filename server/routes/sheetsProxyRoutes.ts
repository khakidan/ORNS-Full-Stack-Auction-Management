import { Router, Request, Response, NextFunction } from 'express';
import { sheetCache, CACHE_TTL, sheetCacheKey } from '../utils/sheetCache';
import { normalizeRange } from '../utils/rangeUtils';
import { sheetsFor, respondIfNotFound } from '../utils/googleClients';

/**
 * Generic Sheets read, cached per user. There is no generic write: every
 * change goes through a route of its own, which takes the right lock and
 * records it in Action History. (The write/append/clear passthrough was
 * removed - ROADMAP A3 - because a range without a tab name wrote the
 * first tab, getting round its ticket-tab and locked-tab refusals.)
 */
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

  return router;
}
