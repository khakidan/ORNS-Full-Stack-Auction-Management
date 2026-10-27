import { Router, Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { setupNewAuction } from '../services/auctionSetupService';
import { requireAuth } from '../middleware/requireAuth';
import { archiveAuctionSpreadsheets } from '../services/archiveService';
import { isDriveId } from '../services/driveService';

export default function createSetupRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post("/setup-new", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
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

  /**
   * Archives the current auction without starting a new year: copies the
   * three master spreadsheets into "{year} Auction" (created if needed),
   * named for the Archived Auctions page, and clears nothing. Safe to run
   * again - the earlier copy goes to the Drive trash.
   */
  router.post("/archive", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
    const { year, ticketsSpreadsheetId, itemEntrySpreadsheetId, bidManagementSpreadsheetId } = req.body || {};
    const parentFolderId = process.env.DRIVE_PARENT_FOLDER_ID;

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: "A four-digit auction year is required." });
    }
    const ids = [ticketsSpreadsheetId, itemEntrySpreadsheetId, bidManagementSpreadsheetId];
    if (!ids.every((id) => typeof id === "string" && isDriveId(id))) {
      return res.status(400).json({ error: "Missing or invalid spreadsheet IDs for archiving." });
    }
    if (!parentFolderId) {
      return res.status(500).json({ error: "DRIVE_PARENT_FOLDER_ID is not configured on the server." });
    }

    try {
      const drive = google.drive({ version: "v3", auth: getAuthenticatedClient(req.session.tokens) });
      const result = await archiveAuctionSpreadsheets(drive, {
        year,
        parentFolderId,
        spreadsheets: { tickets: ticketsSpreadsheetId, items: itemEntrySpreadsheetId, bidManagement: bidManagementSpreadsheetId },
        replaceExisting: true,
      }, (msg) => console.log(`[Auction Archive] ${msg}`));
      res.json({ success: result.results.every((r) => r.status !== "failed"), ...result });
    } catch (error: any) {
      console.error("[Route Error] archive:", error);
      next(error);
    }
  });

  return router;
}
