import { Request } from "express";
import { RuntimeConfig } from "../services/volunteerService";

/**
 * What a volunteer may do: only the Bid Management page's own requests
 * (ROADMAP.md User Permissions item 2 - check in / proxy, Dashboard and
 * Special Winners, winning bids, checkout, receipts). Everything else is
 * refused - a new route is closed to volunteers until it's added here.
 *
 * Matched on the full path (requireAuth runs before the router knows
 * which route matched). `ids` names the request fields that must point at
 * one of the auction's own spreadsheets or folders.
 */
interface VolunteerRoute {
  method: "GET" | "POST";
  path: RegExp;
}

const ROUTES: VolunteerRoute[] = [
  // Reads of the auction's own spreadsheets (checked below).
  { method: "GET", path: /^\/api\/sheets\/[^/]+\/[^/]+$/ },
  { method: "GET", path: /^\/api\/bidders\/setup-status$/ },
  { method: "GET", path: /^\/api\/config\/runtime$/ },
  { method: "POST", path: /^\/api\/bidders\/set-flag$/ },
  { method: "POST", path: /^\/api\/auction\/check-in-with-bid$/ },
  { method: "POST", path: /^\/api\/auction\/special-winner$/ },
  { method: "POST", path: /^\/api\/auction\/record-winning-bid$/ },
  { method: "POST", path: /^\/api\/auction\/checkout-mark-paid$/ },
  { method: "POST", path: /^\/api\/receipts\/(generate|generate-all|email-all|email-only)$/ },
  // The Receipts tab's folder listing (checked below).
  { method: "GET", path: /^\/api\/drive\/files\/[^/]+$/ },
];

/** Body fields that name a spreadsheet; each must be one of the auction's. */
const SPREADSHEET_FIELDS = ["spreadsheetId", "itemsSpreadsheetId", "ticketsSpreadsheetId"];

/** Why a volunteer's request is refused, or null if it's allowed. */
export function volunteerRefusal(req: Request, config: RuntimeConfig): string | null {
  const path = (req.originalUrl || req.url).split("?")[0];
  const route = ROUTES.find((r) => r.method === req.method && r.path.test(path));
  if (!route) return "Volunteers can only use the Bid Management page.";

  const spreadsheets = new Set([config.bidManagementSpreadsheetId, config.auctionItemsSpreadsheetId, config.auctionTicketsSpreadsheetId].filter(Boolean));
  const folders = new Set([config.receiptFolderId, config.forPrintFolderId].filter(Boolean));

  const sheetMatch = /^\/api\/sheets\/([^/]+)\//.exec(path);
  if (sheetMatch && !spreadsheets.has(decodeURIComponent(sheetMatch[1]))) return "That spreadsheet isn't part of this auction.";

  const folderMatch = /^\/api\/drive\/files\/([^/]+)$/.exec(path);
  if (folderMatch && !folders.has(decodeURIComponent(folderMatch[1]))) return "That folder isn't part of this auction.";

  for (const field of SPREADSHEET_FIELDS) {
    const value = req.body?.[field];
    if (value && !spreadsheets.has(String(value))) return "That spreadsheet isn't part of this auction.";
  }
  return null;
}
