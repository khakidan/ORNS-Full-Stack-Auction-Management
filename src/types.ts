export interface Bidder {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  checkedIn: boolean;
  isProxy: boolean;
  checkedOut: boolean;
  paid: boolean;
  checkoutTimestamp?: string;
  rowIndex: number;
}

export interface AuctionItem {
  id: string;
  name: string;
  category: string;
  description: string;
  value: string;
  openingBid: string;
  minRaise: string;
  donor: string;
  itemType: string;
  status: string;
  bundleId: string;
  bundledDateTime: string;
  rowIndex: number;
}

export interface Guest {
  name: string;
  email: string;
  guestIndex: number;
  ownBidderNumber: string;
}

export interface Attendee {
  id: string;
  sheet: string;
  rowIndex: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ticketsPurchased: string;
  hasGuests: string;
  guestsInfo: Guest[];
  paymentMethod: string;
  paymentStatus: string;
  totalPaid: string;
}

export interface GoogleTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type?: string | null;
  scope?: string | null;
}

export interface Config {
  auctionItemsSpreadsheetId: string;
  auctionTicketsSpreadsheetId: string;
  bidManagementSpreadsheetId: string;
  bidderNumbersSheet: string;
  auctionItemsSheet: string;
  bidManagementSheet: string;
  receiptFolderId: string;
  forPrintFolderId: string;
  ornsLogoId: string;
  ticketPrice: string;
  auctionItemsScriptId: string;
  auctionTicketsScriptId: string;
  bidManagementScriptId: string;
  bugReportsSpreadsheetId: string;
  bugReportsFolderId: string;
}

export type BugReportType = "Bug" | "UI Issue" | "Workflow Issue";

export interface BugReportConsoleEntry {
  level: "error" | "warn";
  message: string;
  timestamp: string;
}

/**
 * Shared shape of a submitted bug report - the client builds this and the
 * server (server/routes/bugReportRoutes.ts) trusts it as-is (no further
 * enrichment happens server-side), so every field the report needs to be
 * self-contained must be captured client-side before POSTing.
 */
export interface BugReportPayload {
  title: string;
  description: string;
  type: BugReportType;
  timestamp: string;
  route: string;
  appState: string;
  browserInfo: string;
  consoleActivity: BugReportConsoleEntry[];
  /** Base64-encoded PNG (no data: URL prefix), or null if not captured/included. */
  screenshotBase64: string | null;
}
