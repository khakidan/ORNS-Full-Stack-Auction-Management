import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';

export default function createProductionRouter() {
  const router = Router();

  const handleAppsScriptCall = async (
    req: Request, 
    res: Response, 
    next: NextFunction, 
    functionName: string, 
    scriptId: string, 
    parameters: any[] = []
  ) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });
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

  router.post("/tickets/bidder-labels", (req, res, next) => {
    handleAppsScriptCall(req, res, next, "apiCreateBidderLabels", process.env.SCRIPT_ID_TICKETS!, []);
  });

  return router;
}
