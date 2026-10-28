export type GuestSlotIndex = 1 | 2 | 3;

export interface GuestColumnSet {
  firstName: string;
  lastName: string;
  email: string;
  /** null on the staff/sponsor sheets - no column exists for this there. */
  ownBidderNumber: string | null;
}

/**
 * Single source of truth for the ticket sheets' guest-column layout -
 * previously duplicated between attendeeParsing.ts's raw 0-indexed reads
 * and useTicketAttendeeState.ts's own hardcoded letter map (see the
 * "Attendee Tickets workflow challenges" bug report). The general
 * "tickets" sheet has an extra "own bidder number" column after each
 * guest triple; staff/sponsor sheets don't, so their guest triples are
 * packed tighter.
 */
const GUEST_COLUMN_LETTERS: Record<"tickets" | "default", Record<GuestSlotIndex, GuestColumnSet>> = {
  tickets: {
    1: { firstName: "H", lastName: "I", email: "J", ownBidderNumber: "K" },
    2: { firstName: "L", lastName: "M", email: "N", ownBidderNumber: "O" },
    3: { firstName: "P", lastName: "Q", email: "R", ownBidderNumber: "S" },
  },
  default: {
    1: { firstName: "H", lastName: "I", email: "J", ownBidderNumber: null },
    2: { firstName: "K", lastName: "L", email: "M", ownBidderNumber: null },
    3: { firstName: "N", lastName: "O", email: "P", ownBidderNumber: null },
  },
};

export function guestColumnsForSheet(sheet: string): Record<GuestSlotIndex, GuestColumnSet> {
  return GUEST_COLUMN_LETTERS[sheet === "tickets" ? "tickets" : "default"];
}

export interface GuestRowIndexSet {
  firstName: number;
  lastName: number;
  email: number;
  ownBidderNumber: number | null;
}

/**
 * 0-indexed row-array positions for the same guest layout - matches
 * attendeeParsing.ts's own hardcoded reads exactly (kept as a separate,
 * parallel constant rather than deriving it from GUEST_COLUMN_LETTERS so
 * neither this module nor attendeeParsing.ts needs a letter<->index
 * conversion helper just for this one use).
 */
const GUEST_ROW_INDICES: Record<"tickets" | "default", Record<GuestSlotIndex, GuestRowIndexSet>> = {
  tickets: {
    1: { firstName: 7, lastName: 8, email: 9, ownBidderNumber: 10 },
    2: { firstName: 11, lastName: 12, email: 13, ownBidderNumber: 14 },
    3: { firstName: 15, lastName: 16, email: 17, ownBidderNumber: 18 },
  },
  default: {
    1: { firstName: 7, lastName: 8, email: 9, ownBidderNumber: null },
    2: { firstName: 10, lastName: 11, email: 12, ownBidderNumber: null },
    3: { firstName: 13, lastName: 14, email: 15, ownBidderNumber: null },
  },
};

export function guestRowIndicesForSheet(sheet: string): Record<GuestSlotIndex, GuestRowIndexSet> {
  return GUEST_ROW_INDICES[sheet === "tickets" ? "tickets" : "default"];
}

export interface PaymentColumnSet {
  paymentMethod: string;
  paymentStatus: string;
  totalPaid: string;
}

/**
 * Payment Method/Total Paid are only meaningfully editable on the general
 * "tickets" sheet - attendeeParsing.ts always overrides staff/sponsor
 * rows to hardcoded Comp/Paid/$0 regardless of what these columns hold,
 * so an edit there would appear to silently revert on the next refresh.
 */
export function paymentColumnsForSheet(sheet: string): PaymentColumnSet {
  return sheet === "tickets"
    ? { paymentMethod: "T", paymentStatus: "U", totalPaid: "V" }
    : { paymentMethod: "Q", paymentStatus: "R", totalPaid: "S" };
}

/**
 * The Fluent Forms entry ID of the purchase that made a "tickets" row
 * (ROADMAP W1): column W, the first free one after the payment columns
 * (T-V). Written by the ticket form's Sheets feed (and later by the
 * webhook and poll, W2-W5), which match rows by it - never by name or
 * email. Blank for walk-ins and rows added in the app. Only the "tickets"
 * sheet has it; staff/sponsor tickets don't come from the form.
 */
export const FORM_ENTRY_ID_COLUMN = { letter: "W", index: 22 } as const;
