import { Router, Request, Response, NextFunction } from 'express';
import { isAppsScriptFailure, runAppsScript } from '../utils/appsScriptRun';
import { AlreadyRunningError, runIfIdle } from '../utils/asyncLock';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { requireAuth } from '../middleware/requireAuth';
import { ensureBidderNumbersSheet, getBidderLabelList } from '../services/syncService';
import { getValidSortedItems } from '../services/itemDataService';
import { sheetsFor } from '../utils/googleClients';

export default function createProductionRouter() {
  const router = Router();
  router.use(requireAuth);

  const handleAppsScriptCall = async (
    req: Request,
    res: Response,
    next: NextFunction,
    functionName: string,
    scriptId: string,
    parameters: any[] = []
  ) => {
    if (!scriptId) return res.status(400).json({ error: "Missing Target Environment Script ID" });

    try {
      // One run of each document at a time: every run creates a new file,
      // so a double-click or a resent request would make a duplicate.
      await runIfIdle(`apps-script:${scriptId}:${functionName}`, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const script = google.script({ version: "v1", auth: client });

        console.log(`[Production API] Executing ${functionName} on Script ID ${scriptId}`);

        const result = await runAppsScript(script, scriptId, functionName, parameters);
        if (isAppsScriptFailure(result)) {
          return res.status(400).json(result);
        }

        res.json(result || { success: true });
      });
    } catch (error: any) {
      if (error instanceof AlreadyRunningError) return res.status(409).json({ error: "This document is already being created. Wait for it to finish, then check the folder." });
      console.error(`[Production API Error] ${functionName}:`, error);
      next(error);
    }
  };

  /**
   * ITEM ENTRY SPREADSHEET COMMANDS
   *
   * Node resolves the valid, sorted item list itself (see
   * itemDataService.ts's getValidSortedItems, the Node port of
   * Class_AuctionItemManager.gs's getValidSortedItems) and hands it to
   * each Doc/Slides generator as a parameter, instead of every generator
   * opening the Items spreadsheet and resolving it independently inside
   * GAS - purely for architectural consistency with the rest of this
   * app's GAS projects (Code Hardening item #3), the same "Node resolves
   * data, GAS only turns it into an artifact" shape already used for
   * receipts and bidder labels. See docs/agents/refactor-opportunities.md
   * / CHANGELOG.md.
   */
  const handleItemEntryDoc = async (
    req: Request,
    res: Response,
    next: NextFunction,
    functionName: string
  ) => {
    const { folderId, spreadsheetId } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const sheets = sheetsFor(req);
      const items = await getValidSortedItems(sheets, spreadsheetId);
      await handleAppsScriptCall(req, res, next, functionName, process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || "", items]);
    } catch (error) {
      next(error);
    }
  };

  router.post("/item-entry/bundling-doc", (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateBundlingDoc");
  });

  router.post("/item-entry/item-labels", (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateItemLabels");
  });

  router.post("/item-entry/slideshow", (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateSlideshow");
  });

  router.post("/item-entry/bidding-guide-cover", (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateBiddingGuideCoverPage");
  });

  router.post("/item-entry/bidding-guide-inner", (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateBiddingGuideInnerPages");
  });

  router.post("/item-entry/bid-sheets", (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateBidSheets");
  });

  router.post("/item-entry/catalog", (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateCatalog");
  });

  router.post("/item-entry/table-tents", (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateTableTents");
  });

  /**
   * TICKETS SPREADSHEET COMMANDS
   */

  router.post("/tickets/bidder-labels", async (req, res, next) => {
    const { folderId, bidManagementSpreadsheetId, auctionTicketsSpreadsheetId } = req.body;

    // Real auction workflow (see CHANGELOG.md): bidder labels get printed
    // 2-3 days before the auction, while "Set Up Bid Management App" - and
    // therefore Bidder-Numbers, the sheet this route reads bidder names/
    // numbers from - isn't run until day-of. Build it here first if it
    // isn't there yet, so labels don't depend on Bid-Management being set
    // up. Idempotent (a no-op once Bidder-Numbers has real data), so
    // re-running this to regenerate labels never reassigns a number
    // already printed.
    //
    // Node reads Bidder-Numbers itself and hands the Apps Script side a
    // plain { name, number } list - GAS no longer opens the Bid-Management
    // spreadsheet or re-derives bidder numbers by matching names/emails
    // against the ticket sheets (that used to live in
    // scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_BidderManager.gs,
    // which the .gs source's own comment admitted had to "stay
    // byte-for-byte identical" to this file's matching logic - see
    // refactor-opportunities.md).
    let bidders: { name: string; number: string }[] = [];
    if (bidManagementSpreadsheetId) {
      try {
        const sheets = sheetsFor(req);
        await ensureBidderNumbersSheet(sheets, bidManagementSpreadsheetId, auctionTicketsSpreadsheetId || "");
        bidders = await getBidderLabelList(sheets, bidManagementSpreadsheetId);
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    }

    handleAppsScriptCall(req, res, next, "apiCreateBidderLabels", process.env.SCRIPT_ID_TICKETS!, [folderId || "", bidders]);
  });

  return router;
}
