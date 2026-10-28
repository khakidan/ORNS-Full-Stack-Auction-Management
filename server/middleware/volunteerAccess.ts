import { Request } from "express";
import { RuntimeConfig } from "../services/volunteerService";

/**
 * What a volunteer may do: only the Bid Management page's own requests
 * (ROADMAP.md User Permissions item 2 - check in / proxy, Dashboard and
 * Special Winners, winning bids, checkout, receipts). Everything else is
 * refused - a new route is closed to volunteers until it's added here.
 *
 * Matched on the full path (requireAuth runs before the router knows
 * which route matched). A route here that names a spreadsheet in its body
 * must take it through `fromConfig` (middleware/fromConfig.ts), which
 * replaces it with the auction's own and never lets a volunteer supply one.
 */
interface VolunteerRoute {
  method: "GET" | "POST";
  path: RegExp;
}

const ROUTES: VolunteerRoute[] = [
  // Reads of the tabs Bid Management shows (checked below).
  { method: "GET", path: /^\/api\/sheets\/[^/]+\/[^/]+$/ },
  // The ticket list with only the Bidders tab's badge fields - never the ticket spreadsheet itself.
  { method: "GET", path: /^\/api\/attendees\/badges$/ },
  { method: "GET", path: /^\/api\/bidders\/setup-status$/ },
  // The auction's Config - for a volunteer, only the Bid Management fields.
  { method: "GET", path: /^\/api\/config$/ },
  // Live refresh: which spreadsheets changed (no data, just IDs).
  { method: "GET", path: /^\/api\/changes$/ },
  { method: "POST", path: /^\/api\/bidders\/set-flag$/ },
  { method: "POST", path: /^\/api\/auction\/check-in-with-bid$/ },
  { method: "POST", path: /^\/api\/auction\/special-winner$/ },
  { method: "POST", path: /^\/api\/auction\/record-winning-bid$/ },
  { method: "POST", path: /^\/api\/auction\/checkout-mark-paid$/ },
  { method: "POST", path: /^\/api\/receipts\/(generate|generate-all|email-all|email-only)$/ },
  // The Receipts tab's folder listing (checked below).
  { method: "GET", path: /^\/api\/drive\/files\/[^/]+$/ },
];

/** The tab a range names ("'Bid-Management'!A:ZZ" -> "bid-management"); a range without one is refused. */
function tabOf(range: string): string {
  const bang = range.lastIndexOf("!");
  return bang === -1 ? "" : range.slice(0, bang).trim().replace(/^'(.*)'$/, "$1").trim().toLowerCase();
}

/**
 * The tabs a volunteer's screens read, per spreadsheet - nothing from the
 * Tickets spreadsheet (attendee contact and payment details; volunteers
 * get /api/attendees/badges instead - ROADMAP B4), and only Bid
 * Management's own tabs.
 */
function volunteerTabs(config: RuntimeConfig, spreadsheetId: string): Set<string> {
  if (spreadsheetId === config.bidManagementSpreadsheetId) {
    return new Set([config.bidderNumbersSheet || "Bidder-Numbers", config.bidManagementSheet || "Bid-Management", "Auction-Status", "Special-Winners", "Follow-Up"].map((t) => t.toLowerCase()));
  }
  if (spreadsheetId === config.auctionItemsSpreadsheetId) {
    return new Set(["auction-items", "value calculations", "categories"]);
  }
  return new Set();
}

/** Why a volunteer's request is refused, or null if it's allowed. */
export function volunteerRefusal(req: Request, config: RuntimeConfig): string | null {
  const path = (req.originalUrl || req.url).split("?")[0];
  const route = ROUTES.find((r) => r.method === req.method && r.path.test(path));
  if (!route) return "Volunteers can only use the Bid Management page.";

  const spreadsheets = new Set([config.bidManagementSpreadsheetId, config.auctionItemsSpreadsheetId, config.auctionTicketsSpreadsheetId].filter(Boolean));
  const folders = new Set([config.receiptFolderId, config.forPrintFolderId].filter(Boolean));

  const sheetMatch = /^\/api\/sheets\/([^/]+)\/([^/]+)$/.exec(path);
  if (sheetMatch) {
    const id = decodeURIComponent(sheetMatch[1]);
    if (!spreadsheets.has(id)) return "That spreadsheet isn't part of this auction.";
    if (!volunteerTabs(config, id).has(tabOf(decodeURIComponent(sheetMatch[2])))) return "Volunteers can't open that part of the spreadsheet.";
  }

  const folderMatch = /^\/api\/drive\/files\/([^/]+)$/.exec(path);
  if (folderMatch && !folders.has(decodeURIComponent(folderMatch[1]))) return "That folder isn't part of this auction.";
  return null;
}
