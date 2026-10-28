import { Request, Response, NextFunction } from "express";
import { getSharedConfig, SharedConfig } from "../services/configService";

/** Request body field -> the Config field that supplies it. */
type ConfigFields = Record<string, keyof SharedConfig>;

/**
 * Fills the named request-body fields from the auction's Config (the
 * server's own copy, configService.ts), so a route works on this year's
 * spreadsheets and tab names whatever an open browser last loaded - a tab
 * left open from before a Config change can't write to last year's
 * spreadsheet (ROADMAP A13).
 *
 * The Config wins. While a Config field is blank, a staff member's body
 * value is used as before; a volunteer's, or someone not signed in (bug
 * reports), never is (the field is removed, so the route refuses the
 * request), which is what keeps a volunteer to the auction's own
 * spreadsheets. Every volunteer route that names a spreadsheet must go
 * through this (volunteerAccess.ts).
 *
 * `from: "query"` does the same for a GET route's query string.
 */
export function fromConfig(fields: ConfigFields, from: "body" | "query" = "body") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    let config: SharedConfig | null = null;
    try {
      config = await getSharedConfig();
    } catch (err: any) {
      console.warn("[fromConfig] Couldn't read the Config; using the request's own values:", err?.message || err);
    }
    const staff = !!req.user && req.user.role !== "volunteer";
    const target: Record<string, unknown> = req[from] && typeof req[from] === "object" ? req[from] : {};
    if (from === "body") req.body = target;
    for (const [field, configField] of Object.entries(fields)) {
      const value = config?.[configField];
      if (typeof value === "string" && value) target[field] = value;
      else if (!staff) delete target[field];
    }
    next();
  };
}

/** Bid Management routes: its spreadsheet, tab names and ticket price. */
export const BID_MANAGEMENT_FIELDS: ConfigFields = {
  spreadsheetId: "bidManagementSpreadsheetId",
  bidderNumbersSheet: "bidderNumbersSheet",
  bidManagementSheet: "bidManagementSheet",
  ticketPrice: "ticketPrice",
};

/** Receipts and emails also read the items, and file receipts in this year's folder. */
export const RECEIPT_FIELDS: ConfigFields = {
  ...BID_MANAGEMENT_FIELDS,
  itemsSpreadsheetId: "auctionItemsSpreadsheetId",
  receiptFolderId: "receiptFolderId",
};

/** Attendee List routes: the Auction Tickets spreadsheet. */
export const TICKET_FIELDS: ConfigFields = { spreadsheetId: "auctionTicketsSpreadsheetId" };

/** Auction Items routes: its spreadsheet. */
export const ITEM_FIELDS: ConfigFields = { spreadsheetId: "auctionItemsSpreadsheetId" };

/** Item documents: the items, filed in this year's For Print folder. */
export const ITEM_DOCUMENT_FIELDS: ConfigFields = { ...ITEM_FIELDS, folderId: "forPrintFolderId" };

/** Bidder labels: Bidder-Numbers, built from the ticket sheets, filed in this year's For Print folder. */
export const BIDDER_LABEL_FIELDS: ConfigFields = {
  folderId: "forPrintFolderId",
  bidManagementSpreadsheetId: "bidManagementSpreadsheetId",
  auctionTicketsSpreadsheetId: "auctionTicketsSpreadsheetId",
};

/** Set Up Bid Management App: Bid Management, from the ticket sheets. */
export const SYNC_FIELDS: ConfigFields = {
  spreadsheetId: "bidManagementSpreadsheetId",
  auctionTicketSheetsID: "auctionTicketsSpreadsheetId",
};

/** `_Settings` saves: the Bid Management spreadsheet, which its Apps Script reads. */
export const SETTINGS_FIELDS: ConfigFields = { spreadsheetId: "bidManagementSpreadsheetId" };

/** Setup New Auction Year and Archive: the three master spreadsheets. */
export const MASTER_SPREADSHEET_FIELDS: ConfigFields = {
  ticketsSpreadsheetId: "auctionTicketsSpreadsheetId",
  itemEntrySpreadsheetId: "auctionItemsSpreadsheetId",
  bidManagementSpreadsheetId: "bidManagementSpreadsheetId",
};

/** Bug report submission: the Bug Reports spreadsheet and screenshot folder. */
export const BUG_REPORT_FIELDS: ConfigFields = {
  bugReportsSpreadsheetId: "bugReportsSpreadsheetId",
  bugReportsFolderId: "bugReportsFolderId",
};

/** Bug report list and resolve: the Bug Reports spreadsheet. */
export const BUG_REPORT_ADMIN_FIELDS: ConfigFields = { spreadsheetId: "bugReportsSpreadsheetId" };
