import { TICKETS_COL } from "../utils/sheetColumns";
import { sanitizeForSheetFormula } from "../utils/sheetFormula";
import { FORM_ENTRY_ID_COLUMN, guestRowIndicesForSheet, GuestSlotIndex } from "../../src/lib/attendeeSheetColumns";

/**
 * One ticket purchase from the Fluent Forms "Auction Tickets" form,
 * already pulled out of whichever shape it arrived in - the webhook's
 * payload (ROADMAP W3) or an entry from the REST API poll (W5) each
 * translate into this, so the row is built one way (W2).
 */
export interface TicketPurchase {
  /** Fluent Forms' entry ID (`{submission.id}`), not the serial number. */
  entryId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Tickets bought (the form's quantity). */
  tickets: number;
  guests: TicketPurchaseGuest[];
  /** Fluent Forms' payment method key: "paypal", or "test" - its offline (cash or check) method, which the form's Sheets feed shows as "Offline". */
  paymentMethod: string;
  /** Fluent Forms' payment status: "paid", "pending" (cash or check, paid offline), "refunded", ... */
  paymentStatus: string;
  /** Order total in dollars. */
  total: number;
  /** The payment's transaction ID (PayPal's, for an online payment), for W4 to check with PayPal; not written to the row. */
  transactionId?: string;
}

export interface TicketPurchaseGuest {
  firstName: string;
  lastName: string;
  email: string;
  /** "Should this guest have their own bidder number?" */
  ownBidderNumber: boolean;
}

export type TicketRowResult = { row: (string | number)[] } | { problems: string[] };

/** Longest text kept from any one field; the form's own fields are far shorter. */
export const MAX_FIELD_LENGTH = 200;
const MAX_TICKETS = 20;
const MAX_GUESTS = 3;

/**
 * What the form's own Sheets feed writes for each method, so rows from the
 * webhook and poll look the same as the feed's: Fluent Forms' offline
 * (cash or check) method has the key "test" and shows as "Offline".
 */
const PAYMENT_METHODS: Record<string, string> = { paypal: "PayPal", test: "Offline", offline: "Offline", stripe: "Stripe" };
const PAYMENT_STATUSES: Record<string, string> = { paid: "Paid", pending: "Pending", refunded: "Refunded", failed: "Failed", cancelled: "Cancelled" };

/** Public text for a cell: trimmed, capped, never run as a formula. */
function text(value: unknown): string {
  return sanitizeForSheetFormula(String(value ?? "").trim().slice(0, MAX_FIELD_LENGTH));
}

/** A known key's label, else the value itself with a capital first letter. */
function label(labels: Record<string, string>, value: string): string {
  const key = value.trim().toLowerCase();
  if (labels[key]) return labels[key];
  return text(key.charAt(0).toUpperCase() + key.slice(1));
}

/** "$140", "$70.50" - the walk-in row's style (bidderService.ts). */
function dollars(total: number): string {
  return Number.isInteger(total) ? `$${total}` : `$${total.toFixed(2)}`;
}

/**
 * The purchase's `tickets` row (A-W), in the same layout as the app's Add
 * Attendee and the walk-in row: names A/B, email C, phone D, tickets E,
 * "yes" in F when there are guests, guests H-S with "yes"/"no" for their
 * own bidder number, payment method T ("PayPal" or "Offline", as the
 * form's Sheets feed writes it), status U, the order total in V
 * (the amount due while Pending, like a walk-in), entry ID in W. Text is
 * trimmed, capped and guarded against formulas.
 *
 * Returns `problems` instead when the purchase can't be written as it
 * stands - those go to staff to review rather than into the sheet half
 * right. A bad email or phone isn't one: the purchase is still real.
 */
export function ticketRowFromPurchase(purchase: TicketPurchase): TicketRowResult {
  const problems: string[] = [];
  const entryId = String(purchase.entryId ?? "").trim();
  if (!/^\d+$/.test(entryId)) problems.push("The entry ID is missing or isn't a number.");
  if (!String(purchase.firstName ?? "").trim() || !String(purchase.lastName ?? "").trim()) problems.push("The buyer's first or last name is missing.");
  if (!Number.isInteger(purchase.tickets) || purchase.tickets < 1 || purchase.tickets > MAX_TICKETS) {
    problems.push(`The number of tickets (${purchase.tickets}) isn't a whole number from 1 to ${MAX_TICKETS}.`);
  }
  // The form sends its unused guest slots blank.
  const guests = (purchase.guests ?? []).filter((g) => [g.firstName, g.lastName, g.email].some((v) => String(v ?? "").trim()));
  if (guests.length > MAX_GUESTS) problems.push(`There are ${guests.length} guests; the sheet has room for ${MAX_GUESTS}.`);
  // Same rule as the app's Add Attendee (hasMoreGuestsThanTicketsPurchased).
  else if (guests.length > purchase.tickets) problems.push(`There are ${guests.length} guests but only ${purchase.tickets} ticket(s).`);
  guests.forEach((g, i) => {
    if (!String(g.firstName ?? "").trim() && !String(g.lastName ?? "").trim()) problems.push(`Guest ${i + 1} has no name.`);
  });
  if (!Number.isFinite(purchase.total) || purchase.total < 0) problems.push("The order total is missing or negative.");
  if (problems.length) return { problems };

  const row: (string | number)[] = new Array(FORM_ENTRY_ID_COLUMN.index + 1).fill("");
  row[TICKETS_COL.firstName] = text(purchase.firstName);
  row[TICKETS_COL.lastName] = text(purchase.lastName);
  row[TICKETS_COL.email] = text(purchase.email);
  row[TICKETS_COL.phone] = text(purchase.phone);
  row[TICKETS_COL.ticketsPurchased] = purchase.tickets;
  row[TICKETS_COL.hasGuests] = guests.length > 0 ? "yes" : "";
  const slots = guestRowIndicesForSheet("tickets");
  guests.forEach((guest, i) => {
    const slot = slots[(i + 1) as GuestSlotIndex];
    row[slot.firstName] = text(guest.firstName);
    row[slot.lastName] = text(guest.lastName);
    row[slot.email] = text(guest.email);
    if (slot.ownBidderNumber !== null) row[slot.ownBidderNumber] = guest.ownBidderNumber ? "yes" : "no";
  });
  row[TICKETS_COL.paymentMethod] = label(PAYMENT_METHODS, String(purchase.paymentMethod ?? ""));
  row[TICKETS_COL.paymentStatus] = String(purchase.paymentStatus ?? "").trim() ? label(PAYMENT_STATUSES, String(purchase.paymentStatus)) : "Pending";
  row[TICKETS_COL.totalPaid] = dollars(purchase.total);
  row[FORM_ENTRY_ID_COLUMN.index] = entryId;
  return { row };
}
