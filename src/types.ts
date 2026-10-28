export interface Bidder {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  checkedIn: boolean;
  isProxy: boolean;
  checkedOut: boolean;
  paid: boolean;
  paymentMethod?: string;
  checkoutTimestamp?: string;
  /** Where their ticket is ("tickets!12", "tickets!12#2" for a guest) - src/lib/ticketRef.ts. */
  ticketRef?: string;
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
  allowMultipleWinners?: boolean;
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
  /** The Fluent Forms entry that bought this ticket ("tickets" sheet only; blank when added another way) - ROADMAP W1. */
  formEntryId?: string;
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
  /**
   * Unused: the server runs the scripts by its SCRIPT_ID_* environment
   * settings. Kept (and saved through unchanged) in settings/global
   * (server/services/configService.ts) for now.
   */
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
 * Settings page's sweeper status card, the only way to confirm
 * from inside the app (rather than server logs) that the two manual-only
 * steps from Code Hardening item #2 have actually happened: an admin
 * signing in once (credentialConfigured), and the background job running
 * reliably (lastRunAt/lastResult). See
 * docs/agents/CHANGELOG.md.
 */
export interface SweeperStatus {
  credentialConfigured: boolean;
  credentialUpdatedBy: string | null;
  credentialUpdatedAt: string | null;
  /** The Cloud Scheduler job's expected interval. */
  intervalMinutes: number;
  /** Cloud Scheduler triggered a sweep recently. False = the job is paused (off-season) or not set up. */
  scheduleActive: boolean;
  lastScheduledRunAt: string | null;
  lastRunAt: string | null;
  lastResult: PaypalSweepOutcome | null;
}

/** The Tickets page's website-purchases status card (server/routes/ticketPollRoutes.ts, ROADMAP W6). */
export interface TicketPurchaseStatus {
  /** The Fluent Forms API is set up on the server, so the poll can run. */
  configured: boolean;
  /** "compare" until the switch-over: the Sheets feed adds rows and the webhook and poll only report. */
  mode: "write" | "compare";
  lastWebhook: { at: string; entryId: string; outcome: string; error?: string } | null;
  poll: { lastSuccessAt: string | null; lastRunAt: string | null; lastRunErrors: string[]; seasonStartEntryId: number } | null;
  /** Entries the poll had to add (or found missing from the sheet) - each one a webhook that was missed. */
  missed: { entryId: string; at: string }[];
  /** Entry ID -> when it was submitted (WordPress's local time, "2027-02-01 10:00:00"). */
  submittedAt: Record<string, string>;
  review: { entryId: string; name: string; problems: string[]; firstSeenAt: string; lastSeenAt: string }[];
}

/** What one poll run did (server/services/ticketPoll.ts). */
export interface TicketPollRun {
  at: string;
  mode: "write" | "compare";
  newEntries: number;
  added: string[];
  wouldAdd: string[];
  needsReview: string[];
  paymentsSet: string[];
  paymentsWouldSet: string[];
  paymentsNeedReview: string[];
  errors: string[];
}

/** One past auction's archived spreadsheets on Drive (server/services/archiveService.ts). Null = not found. */
export interface ArchivedAuction {
  year: number;
  folderId: string | null;
  folderLink: string | null;
  bidManagementSpreadsheetId: string | null;
  itemsSpreadsheetId: string | null;
  /** "{year} Action History" - who did what that season (absent from older lookups). */
  actionHistorySpreadsheetId?: string | null;
}
