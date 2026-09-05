import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { requireAuth } from '../middleware/requireAuth';
import { ensureBidderNumbersSheet, getBidderLabelList } from '../services/syncService';

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
      const client = getAuthenticatedClient(req.session.tokens);
      const script = google.script({ version: "v1", auth: client });

      console.log(`[Production API] Executing ${functionName} on Script ID ${scriptId}`);

      const response = await script.scripts.run({
        scriptId,
        requestBody: {
          function: functionName,
          parameters,
          devMode: true,
        },
      });

      if (response.data.error) {
        throw new Error(response.data.error.details?.[0]?.errorMessage || response.data.error.message || "Apps Script Execution Error");
      }

      const result: any = response.data.response?.result;
      if (result && result.success === false) {
          return res.status(400).json(result);
      }
      
      res.json(result || { success: true });
    } catch (error: any) {
      console.error(`[Production API Error] ${functionName}:`, error);
      next(error);
    }
  };

  /**
   * ITEM ENTRY SPREADSHEET COMMANDS
   */

  router.post("/item-entry/bundling-doc", (req, res, next) => {
    const { folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBundlingDoc", process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || ""]);
  });

  router.post("/item-entry/item-labels", (req, res, next) => {
    const { folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateItemLabels", process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || ""]);
  });

  router.post("/item-entry/slideshow", (req, res, next) => {
    const { folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateSlideshow", process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || ""]);
  });

  router.post("/item-entry/bidding-guide-cover", (req, res, next) => {
    const { folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBiddingGuideCoverPage", process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || ""]);
  });

  router.post("/item-entry/bidding-guide-inner", (req, res, next) => {
    const { folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBiddingGuideInnerPages", process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || ""]);
  });

  router.post("/item-entry/bid-sheets", (req, res, next) => {
    const { folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBidSheets", process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || ""]);
  });

  router.post("/item-entry/catalog", (req, res, next) => {
    const { folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateCatalog", process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || ""]);
  });

  router.post("/item-entry/table-tents", (req, res, next) => {
    const { folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateTableTents", process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId || ""]);
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
        const client = getAuthenticatedClient(req.session.tokens);
        await ensureBidderNumbersSheet(client, bidManagementSpreadsheetId, auctionTicketsSpreadsheetId || "");
        bidders = await getBidderLabelList(client, bidManagementSpreadsheetId);
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    }

    handleAppsScriptCall(req, res, next, "apiCreateBidderLabels", process.env.SCRIPT_ID_TICKETS!, [folderId || "", bidders]);
  });

  return router;
}
