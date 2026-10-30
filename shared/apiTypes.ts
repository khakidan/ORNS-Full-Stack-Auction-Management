/**
 * The bodies the browser sends to the server's write routes, shared by
 * both sides so a renamed or missing field fails `npm run lint` instead of
 * reaching the server as `undefined` (ROADMAP T5).
 *
 * - The browser: `postJson`/`postJsonOnce` (src/services/apiClient.ts) take
 *   the body type from the path in `ApiRequests`; calls made another way
 *   use `satisfies` with the type.
 * - The server: each route reads `req.body as` its type.
 *
 * These are what a well-behaved browser sends, not a guarantee: the routes
 * still check every value, and `fromConfig` replaces the spreadsheet IDs
 * and tab names with the Config's. Import with `import type` only, so
 * nothing here reaches either bundle.
 */
import type { BugReportPayload } from "../src/types";

/** The tab names a Bid Management request names (the Config's win on the server). */
export interface BidManagementSheets {
  bidManagementSheet: string;
  bidderNumbersSheet: string;
}

export interface RecordWinningBidRequest extends BidManagementSheets {
  bidderId: string;
  itemId: string;
  price: number;
  spreadsheetId: string;
  itemsSpreadsheetId?: string;
  idempotencyKey: string;
}

export interface CheckoutMarkPaidRequest extends BidManagementSheets {
  bidderId: string;
  spreadsheetId: string;
  itemsSpreadsheetId: string;
  ticketsSpreadsheetId: string;
  /** The bidder's own row on the tickets tab, to mark paid there too. */
  attendeeInfo: { sheet: string; rowIndex: number } | null;
  paymentMethod: string;
  idempotencyKey: string;
}

export interface GoLiveRequest {
  spreadsheetId: string;
}

export interface CloseAuctionRequest extends BidManagementSheets {
  spreadsheetId: string;
}

export interface WalkInRequest extends BidManagementSheets {
  firstName: string;
  lastName: string;
  email: string;
  spreadsheetId: string;
  ticketsSpreadsheetId: string;
  /** The Config's price as typed ("35", "37.50"). */
  ticketPrice: string;
  idempotencyKey: string;
}

export interface SpecialWinnerRequest {
  spreadsheetId: string;
  prize: "raffle" | "giftCard";
  /** "" clears the winner. */
  bidderId: string;
  addFollowUp: boolean;
  idempotencyKey: string;
}

export interface SetBidderFlagRequest {
  spreadsheetId: string;
  bidderNumbersSheet: string;
  bidderId: string;
  flag: "checkedIn" | "isProxy";
}

export interface CheckInWithBidRequest extends BidManagementSheets {
  bidderId: string;
  spreadsheetId: string;
  bidValue: number;
  idempotencyKey: string;
}

export interface SyncBiddersRequest {
  spreadsheetId: string;
  auctionTicketSheetsID: string;
}

export interface AddItemRequest {
  spreadsheetId: string;
  category: string;
  name: string;
  description: string;
  value: string;
  donor: string;
  itemType: string;
  allowMultipleWinners: boolean;
  idempotencyKey: string;
}

export interface DeleteItemRequest {
  spreadsheetId: string;
  rowIndex: number;
  idempotencyKey: string;
}

export interface UpdateItemRequest {
  spreadsheetId: string;
  rowIndex: number;
  /** Field name -> new value. */
  changes: Record<string, unknown>;
  /** The name the editor saw, so an edit to a row that has moved is refused (409). */
  expectedName?: string;
}

export interface BulkUpdateItemsRequest {
  spreadsheetId: string;
  rowIndices: number[];
  field: string;
  value: string;
  idempotencyKey: string;
}

export interface BundleSuggestRequest {
  items: { name: string; description?: string }[];
}

export interface BundleProcessRequest {
  spreadsheetId: string;
  targetIds: string[];
  newName: string;
  newDescription: string;
  targetCategory: string;
  value: string;
  openingBid: string;
  minRaise: string;
  donor: string;
  itemType: string;
  bundleEventToken: string;
  timestamp?: string;
  idempotencyKey: string;
}

export interface BundleRestoreRequest {
  spreadsheetId: string;
  targetBundleToken: string;
  idempotencyKey: string;
}

/** Receipts also read the tab names (sheetNamesFromBody) and the Config's folder and logo. */
interface ReceiptRequest extends BidManagementSheets {
  spreadsheetId: string;
  itemsSpreadsheetId: string;
}

export interface GenerateReceiptRequest extends ReceiptRequest {
  bidderId: string;
  receiptFolderId: string;
}

export interface GenerateAllReceiptsRequest extends ReceiptRequest {
  receiptFolderId: string;
  /** Which batch of bidders (1-based); the server splits long runs. */
  part: number;
}

export interface EmailAllReceiptsRequest extends ReceiptRequest {
  idempotencyKey: string;
}

export interface EmailReceiptRequest extends ReceiptRequest {
  bidderId: string;
  idempotencyKey: string;
}

export interface MasterSpreadsheetsRequest {
  ticketsSpreadsheetId: string;
  itemEntrySpreadsheetId: string;
  bidManagementSpreadsheetId: string;
}

export interface ArchiveAuctionRequest extends MasterSpreadsheetsRequest {
  year: number;
}

export interface ItemDocumentRequest {
  folderId: string;
  spreadsheetId: string;
  ornsLogoId?: string;
}

export interface BidderLabelsRequest {
  folderId: string;
  bidManagementSpreadsheetId: string;
  auctionTicketsSpreadsheetId: string;
}

export interface AddAttendeeRequest {
  spreadsheetId: string;
  sheet: string;
  row: unknown[];
  idempotencyKey: string;
}

export interface UpdateAttendeeRequest {
  spreadsheetId: string;
  range: string;
  values: unknown[][];
}

export interface DeleteAttendeeRequest {
  spreadsheetId: string;
  sheet: string;
  rowIndex: number;
}

export interface EditTrackingRequest {
  enabled: boolean;
  itemsSpreadsheetId: string;
  ticketsSpreadsheetId: string;
}

export interface InviteVolunteerRequest {
  name: string;
  email: string;
}

export interface SetRoleRequest {
  role: string;
}

export interface BugReportRequest extends BugReportPayload {
  bugReportsSpreadsheetId: string;
  bugReportsFolderId: string;
  idempotencyKey: string;
}

export interface ResolveBugReportRequest {
  spreadsheetId: string;
  reportId: string;
}

/** Routes that take no body. */
export type EmptyRequest = Record<string, never>;

/** Path -> body, for postJson/postJsonOnce. A path not listed here takes any body. */
export interface ApiRequests {
  "/api/auction/record-winning-bid": RecordWinningBidRequest;
  "/api/auction/checkout-mark-paid": CheckoutMarkPaidRequest;
  "/api/auction/go-live": GoLiveRequest;
  "/api/auction/close-and-cleanup": CloseAuctionRequest;
  "/api/auction/special-winner": SpecialWinnerRequest;
  "/api/auction/check-in-with-bid": CheckInWithBidRequest;
  "/api/auction/add-item": AddItemRequest;
  "/api/auction/delete-item": DeleteItemRequest;
  "/api/auction/update-item": UpdateItemRequest;
  "/api/auction/bulk-update-items": BulkUpdateItemsRequest;
  "/api/auction/setup-new": MasterSpreadsheetsRequest;
  "/api/auction/archive": ArchiveAuctionRequest;
  "/api/bidders/walk-in": WalkInRequest;
  "/api/bidders/set-flag": SetBidderFlagRequest;
  "/api/bidders/sync": SyncBiddersRequest;
  "/api/bidders/sync-from-tickets": EmptyRequest;
  "/api/bundle/process": BundleProcessRequest;
  "/api/bundle/restore": BundleRestoreRequest;
  "/api/receipts/email-all": EmailAllReceiptsRequest;
  "/api/receipts/email-only": EmailReceiptRequest;
  "/api/attendees/delete": DeleteAttendeeRequest;
  "/api/action-history/create": EmptyRequest;
  "/api/action-history/edit-tracking": EditTrackingRequest;
  "/api/bug-reports": BugReportRequest;
  "/api/bug-reports/resolve": ResolveBugReportRequest;
}

/** The body type for `path`: its entry in ApiRequests, or unknown for an unlisted path. */
export type ApiRequestBody<P extends string> = P extends keyof ApiRequests ? ApiRequests[P] : unknown;
