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
  firstName: string;
  lastName: string;
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
  /**
   * true = PayPal sandbox mode (safe for testing, no real invoices/emails).
   * false = production mode (real invoices sent to real bidders). Defaults
   * to true everywhere it's read so a missing/unset value never accidentally
   * means production.
   */
  paypalIsSandbox: boolean;
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

/**
 * One row read back from the Bug-Reports sheet (GET /api/bug-reports/list)
 * - the admin-facing counterpart to BugReportPayload above. Console
 * activity/app state/browser info are already flattened to their
 * formatted string form by the server (see bugReportService.ts's
 * formatConsoleActivityForFile), not re-parsed back into structured data,
 * since the admin list view only ever needs to display them, not act on
 * them individually.
 */
export interface BugReportListItem {
  reportId: string;
  timestamp: string;
  status: string;
  type: string;
  title: string;
  description: string;
  route: string;
  appState: string;
  browserInfo: string;
  consoleActivity: string;
  screenshotLink: string;
}

/** One sweep's outcome (server/services/paypalSweeperJob.ts's PaypalSweepOutcome). */
export type PaypalSweepOutcome =
  | { pending: number; resolved: number; escalated: number }
  | { skipped: string };

/**
 * GET /api/paypal-sweeper/status's response shape - drives the
 * Configuration page's sweeper status card, the only way to confirm
 * from inside the app (rather than server logs) that the two manual-only
 * steps from Code Hardening item #2 have actually happened: an admin
 * signing in once (credentialConfigured), and the background job running
 * reliably (lastRunAt/lastResult). See
 * docs/agents/refactor-opportunities.md.
 */
export interface SweeperStatus {
  credentialConfigured: boolean;
  credentialUpdatedBy: string | null;
  credentialUpdatedAt: string | null;
  intervalMinutes: number;
  scheduleRunning: boolean;
  lastRunAt: string | null;
  lastResult: PaypalSweepOutcome | null;
  nextRunAt: string | null;
}
