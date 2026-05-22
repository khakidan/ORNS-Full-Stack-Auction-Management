import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../utils/auth';

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
    const { scriptId, folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBundlingDoc", scriptId, [folderId || ""]);
  });

  router.post("/item-entry/item-labels", (req, res, next) => {
    const { scriptId, folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateItemLabels", scriptId, [folderId || ""]);
  });

  router.post("/item-entry/slideshow", (req, res, next) => {
    const { scriptId, folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateSlideshow", scriptId, [folderId || ""]);
  });

  router.post("/item-entry/bidding-guide-cover", (req, res, next) => {
    const { scriptId, folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBiddingGuideCoverPage", scriptId, [folderId || ""]);
  });

  router.post("/item-entry/bidding-guide-inner", (req, res, next) => {
    const { scriptId, folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBiddingGuideInnerPages", scriptId, [folderId || ""]);
  });

  router.post("/item-entry/bid-sheets", (req, res, next) => {
    const { scriptId, folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBidSheets", scriptId, [folderId || ""]);
  });

  router.post("/item-entry/catalog", (req, res, next) => {
    const { scriptId, folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateCatalog", scriptId, [folderId || ""]);
  });

  router.post("/item-entry/table-tents", (req, res, next) => {
    const { scriptId, folderId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateTableTents", scriptId, [folderId || ""]);
  });

  /**
   * TICKETS SPREADSHEET COMMANDS
   */

  router.post("/tickets/bidder-labels", (req, res, next) => {
    const { scriptId } = req.body;
    handleAppsScriptCall(req, res, next, "apiCreateBidderLabels", scriptId, []);
  });

  return router;
}
