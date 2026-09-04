import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { setupNewAuction } from '../services/auctionSetupService';
import { requireAuth } from '../middleware/requireAuth';

export default function createSetupRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post("/setup-new", async (req: Request, res: Response, next: NextFunction) => {
    const {
      ticketsSpreadsheetId, 
      itemEntrySpreadsheetId, 
      bidManagementSpreadsheetId 
    } = req.body;

    if (!ticketsSpreadsheetId || !itemEntrySpreadsheetId || !bidManagementSpreadsheetId) {
      return res.status(400).json({ error: "Missing required spreadsheet IDs for auction setup." });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const client = getAuthenticatedClient(req.session.tokens);
    const drive = google.drive({ version: "v3", auth: client });
    const sheets = google.sheets({ version: "v4", auth: client });

    const logs: string[] = [];
    const onLog = (msg: string) => {
      console.log(`[Auction Setup] ${msg}`);
      logs.push(msg);
      res.write(JSON.stringify({ log: msg }) + "\n");
    };

    try {
      const result = await setupNewAuction(
        drive,
        sheets,
        {
          ticketsSpreadsheetId,
          itemEntrySpreadsheetId,
          bidManagementSpreadsheetId
        },
        onLog
      );

      res.write(JSON.stringify({
        ...result,
        logs
      }) + "\n");
      res.end();

    } catch (error: any) {
      console.error("[Route Error] setup-new:", error);
      // For streaming errors, we often write a final error message to the NDJSON stream
      // before ending it, rather than just calling next(error) which might send an HTML error page.
      if (!res.headersSent) {
        return next(error);
      }
      
      res.write(JSON.stringify({ 
        success: false,
        error: error.message,
        logs
      }) + "\n");
      res.end();
    }
  });

  return router;
}
