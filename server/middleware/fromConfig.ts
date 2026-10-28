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
 * value is used as before; a volunteer's never is (the field is removed,
 * so the route refuses the request), which is what keeps a volunteer to
 * the auction's own spreadsheets. Every volunteer route that names a
 * spreadsheet must go through this (volunteerAccess.ts).
 */
export function fromConfig(fields: ConfigFields) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    let config: SharedConfig | null = null;
    try {
      config = await getSharedConfig();
    } catch (err: any) {
      console.warn("[fromConfig] Couldn't read the Config; using the request's own values:", err?.message || err);
    }
    const volunteer = req.user?.role === "volunteer";
    req.body = req.body && typeof req.body === "object" ? req.body : {};
    for (const [bodyField, configField] of Object.entries(fields)) {
      const value = config?.[configField];
      if (typeof value === "string" && value) req.body[bodyField] = value;
      else if (volunteer) delete req.body[bodyField];
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

/** Receipts and emails also read the items. */
export const RECEIPT_FIELDS: ConfigFields = {
  ...BID_MANAGEMENT_FIELDS,
  itemsSpreadsheetId: "auctionItemsSpreadsheetId",
};

/** Attendee List routes: the Auction Tickets spreadsheet. */
export const TICKET_FIELDS: ConfigFields = { spreadsheetId: "auctionTicketsSpreadsheetId" };
