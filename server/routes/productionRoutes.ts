import { Router, Request, Response, NextFunction } from 'express';
import { logAction, ActionArea, ActionEntry } from '../services/actionLog';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { fromConfig, ITEM_DOCUMENT_FIELDS, BIDDER_LABEL_FIELDS } from '../middleware/fromConfig';
import { isAppsScriptFailure, runAppsScript } from '../utils/appsScriptRun';
import { AlreadyRunningError, runIfIdle } from '../utils/asyncLock';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { requireAuth } from '../middleware/requireAuth';
import { ensureBidderNumbersSheet, getBidderLabelList } from '../services/syncService';
import { getValidSortedItems } from '../services/itemDataService';
import { sheetsFor } from '../utils/googleClients';
import { syncBiddersFromTickets } from '../services/bidderTicketSync';

/**
 * Documents always go to the Config's For Print folder: without one the
 * scripts would fall back to a folder in their own _Settings tab, which
 * nothing keeps up to date (ROADMAP B11).
 */
const MISSING_PRINT_FOLDER = "Set the For Print Folder ID in Settings before creating documents.";

/** Each document's name in Action History (ROADMAP B8). */
const DOCUMENT_NAMES: Record<string, string> = {
  apiCreateBundlingDoc: "bundling document",
  apiCreateItemLabels: "item labels",
  apiCreateSlideshow: "live auction slideshow",
  apiCreateBiddingGuideCoverPage: "bidding guide cover page",
  apiCreateBiddingGuideInnerPages: "bidding guide inner pages",
  apiCreateBidSheets: "bid sheets",
  apiCreateCatalog: "auction catalog",
  apiCreateTableTents: "table tents",
  apiCreateBidderLabels: "bidder labels",
};

/** The Action History row for a document that was made: each run creates a new Drive file. */
function documentCreated(functionName: string, area: ActionArea): ActionEntry {
  const name = DOCUMENT_NAMES[functionName] || functionName;
  return {
    area,
    action: `Create ${name}`,
    target: name,
    summary: `Created the ${name} in the For Print folder`,
    notUndoableReason: "a new file was made in the For Print folder; delete it in Drive if it isn't wanted",
  };
}

export default function createProductionRouter() {
  const router = Router();
  router.use(requireAuth);

  const handleAppsScriptCall = async (
    req: Request,
    res: Response,
    next: NextFunction,
    functionName: string,
    scriptId: string,
    parameters: any[],
    area: ActionArea
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

        await logAction(req, documentCreated(functionName, area));
        res.json(result || { success: true });
      });
    } catch (error: any) {
      if (error instanceof AlreadyRunningError) return res.status(409).json({ error: "This document is already being created. Wait for it to finish, then check the folder." });
      console.error(`[Production API Error] ${functionName}:`, error);
      next(error);
    }
  };

  const itemDocumentConfig = fromConfig(ITEM_DOCUMENT_FIELDS);

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
   * receipts and bidder labels. See docs/agents/CHANGELOG.md
   * / CHANGELOG.md.
   */
  const handleItemEntryDoc = async (
    req: Request,
    res: Response,
    next: NextFunction,
    functionName: string
  ) => {
    const { folderId, spreadsheetId, ornsLogoId } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });
    if (!folderId) return res.status(400).json({ error: MISSING_PRINT_FOLDER });

    try {
      const sheets = sheetsFor(req);
      const items = await getValidSortedItems(sheets, spreadsheetId);
      // The Config's values win over the script's own _Settings copy (ROADMAP B11).
      const settings = { ornsLogoID: ornsLogoId || "", auctionDevFolderID: folderId };
      await handleAppsScriptCall(req, res, next, functionName, process.env.SCRIPT_ID_ITEM_ENTRY!, [folderId, items, settings], "Auction Items");
    } catch (error) {
      next(error);
    }
  };

  router.post("/item-entry/bundling-doc", itemDocumentConfig, (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateBundlingDoc");
  });

  router.post("/item-entry/item-labels", itemDocumentConfig, (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateItemLabels");
  });

  router.post("/item-entry/slideshow", itemDocumentConfig, (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateSlideshow");
  });

  router.post("/item-entry/bidding-guide-cover", itemDocumentConfig, (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateBiddingGuideCoverPage");
  });

  router.post("/item-entry/bidding-guide-inner", itemDocumentConfig, (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateBiddingGuideInnerPages");
  });

  router.post("/item-entry/bid-sheets", itemDocumentConfig, (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateBidSheets");
  });

  router.post("/item-entry/catalog", itemDocumentConfig, (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateCatalog");
  });

  router.post("/item-entry/table-tents", itemDocumentConfig, (req, res, next) => {
    handleItemEntryDoc(req, res, next, "apiCreateTableTents");
  });

  /**
   * TICKETS SPREADSHEET COMMANDS
   */

  router.post("/tickets/bidder-labels", fromConfig(BIDDER_LABEL_FIELDS), async (req, res, next) => {
    const { folderId, bidManagementSpreadsheetId, auctionTicketsSpreadsheetId } = req.body;
    if (!folderId) return res.status(400).json({ error: MISSING_PRINT_FOLDER });

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
    // CHANGELOG.md).
    let bidders: { name: string; number: string }[] = [];
    if (bidManagementSpreadsheetId) {
      try {
        const sheets = sheetsFor(req);
        const built = await ensureBidderNumbersSheet(sheets, bidManagementSpreadsheetId, auctionTicketsSpreadsheetId || "");
        if (built.created) {
          clearCacheForSpreadsheet(bidManagementSpreadsheetId);
          await logAction(req, {
            area: "Bid Management",
            action: "Build Bidder-Numbers",
            summary: `Built Bidder-Numbers from the ticket sheets for the bidder labels: assigned ${built.count} bidder number(s)`,
            location: "Bid Management 'Bidder-Numbers'",
            notUndoableReason: "the labels print these numbers; Set Up Bid Management App rebuilds the tab before the auction",
          });
        }
        // Labels print each bidder's name - make sure it matches their ticket.
        await syncBiddersFromTickets(req);
        bidders = await getBidderLabelList(sheets, bidManagementSpreadsheetId);
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    }

    handleAppsScriptCall(req, res, next, "apiCreateBidderLabels", process.env.SCRIPT_ID_TICKETS!, [folderId, bidders], "Tickets");
  });

  return router;
}
