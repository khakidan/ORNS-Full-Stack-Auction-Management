/**
 * 0-based column positions in the app's own sheets, so code reads
 * `row[BIDDER_COL.paid]` instead of `row[7]`. Must match
 * docs/agents/schema.md; sheetColumns.test.ts checks BIDDER_COL against
 * the header row the sync writes.
 */

/** Bidder-Numbers (Bid-Management spreadsheet), columns A-O. */
export const BIDDER_COL = {
  id: 0,
  firstName: 1,
  lastName: 2,
  email: 3,
  checkedIn: 4,
  proxy: 5,
  checkedOut: 6,
  paid: 7,
  paymentMethod: 8,
  invoiceUrl: 9,
  invoicedAmount: 10,
  paypalPendingSince: 11,
  receiptEmailedAt: 12,
  receiptEmailedInvoice: 13,
  ticketRef: 14,
} as const;

/** Auction-Items (Auction Items spreadsheet), columns A-M. */
export const ITEM_COL = {
  id: 0,
  category: 1,
  name: 2,
  description: 3,
  value: 4,
  openingBid: 5,
  minRaise: 6,
  donor: 7,
  itemType: 8,
  status: 9,
  bundleId: 10,
  bundledDateTime: 11,
  allowMultipleWinners: 12,
} as const;

/**
 * The Auction Tickets spreadsheet's main 'tickets' tab (one row per ticket
 * purchase; guests in H-S). The staff/sponsor tabs keep their payment
 * columns elsewhere - see src/lib/attendeeSheetColumns.ts, which
 * sheetColumns.test.ts checks these against.
 */
export const TICKETS_COL = {
  firstName: 0,
  lastName: 1,
  email: 2,
  phone: 3,
  ticketsPurchased: 4,
  hasGuests: 5,
  paymentMethod: 19,
  paymentStatus: 20,
  totalPaid: 21,
} as const;

/** What registerWalkInBidder writes in TICKETS_COL.paymentMethod; the sync refuses to rebuild once it's there. */
export const WALK_IN_PAYMENT_METHOD = "Auction Checkout";

/**
 * Bid-Management grid: each bidder owns two columns (item, price); row 1
 * holds the bidder ID, row 2 the name, row 3 the "Item #:"/"Price:"
 * captions, and bids start on row 4 (0-based index 3).
 */
export const BID_GRID_FIRST_BID_ROW_INDEX = 3;
