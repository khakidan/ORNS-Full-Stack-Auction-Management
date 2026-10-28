import { TicketPurchase, TicketPurchaseGuest } from "./ticketPurchaseRow";

/**
 * The body the "Auction Tickets" form's Webhook feed sends (ROADMAP W3):
 * JSON, "Selected Fields", one field per key below, each set to the same
 * smart code the form's Google Sheets feed uses for that column - plus
 * the entry ID. Every value arrives as text (Fluent Forms fills in smart
 * codes as strings); unused guest slots arrive blank.
 *
 *   entry_id            {submission.id}            (not the serial number)
 *   first_name          the Name field's first name
 *   last_name           the Name field's last name
 *   email               Email
 *   phone               Phone Number
 *   tickets             the "Auction Tickets" quantity (payment_input)
 *   guest_N_first_name  Guest #N's first name      (N = 1, 2, 3)
 *   guest_N_last_name   Guest #N's last name
 *   guest_N_email       Guest #N's Email
 *   guest_N_own_number  "Should This Guest Have Their Own Bidder Number?" (the input, not its label)
 *   payment_method      payment method             ("paypal", or "test" for cash/check)
 *   payment_status      payment status             ("paid", "pending", ...)
 *   payment_total       payment total              ("$140.00", "140", ...)
 *   transaction_id      optional - Fluent Forms' Payment Details smart codes have no
 *                       transaction ID (only Receipt, Summary, Order Items, Status,
 *                       Total, Method), so the feed leaves it out and W4 reads the
 *                       transaction from the REST API by entry ID
 */
export const WEBHOOK_FIELDS = [
  "entry_id", "first_name", "last_name", "email", "phone", "tickets",
  ...[1, 2, 3].flatMap((n) => [`guest_${n}_first_name`, `guest_${n}_last_name`, `guest_${n}_email`, `guest_${n}_own_number`]),
  "payment_method", "payment_status", "payment_total", "transaction_id",
] as const;

const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value).trim());

/** "4" -> 4; anything that isn't a whole number -> NaN (W2 then sends it to review). */
function wholeNumber(value: unknown): number {
  const text = str(value);
  return /^\d+$/.test(text) ? Number(text) : NaN;
}

/** "$1,140.00", "140", "70.5" -> dollars; anything else -> NaN. */
function money(value: unknown): number {
  const text = str(value).replace(/[$,\s]/g, "");
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

/** The form's radio answers ("yes"/"no"); a hidden question arrives blank. */
const isYes = (value: unknown) => ["yes", "true", "1"].includes(str(value).toLowerCase());

/**
 * The webhook body as a TicketPurchase for upsertTicketPurchase (W2). It
 * doesn't judge the values - a missing name or a bad ticket count goes
 * through and W2 sends it to review - but a body that isn't a JSON object,
 * or has no entry_id, is refused: that's the feed's set-up, not the
 * purchase (sent as a form instead of JSON, or the field left out), and
 * the refusal shows against the entry in Fluent Forms.
 */
export function purchaseFromWebhook(body: unknown): TicketPurchase | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "The request body must be a JSON object." };
  const b = body as Record<string, unknown>;
  if (!str(b.entry_id)) return { error: "entry_id is missing - check the Webhook feed sends JSON with an entry_id field set to {submission.id}." };
  const guests: TicketPurchaseGuest[] = [1, 2, 3].map((n) => ({
    firstName: str(b[`guest_${n}_first_name`]),
    lastName: str(b[`guest_${n}_last_name`]),
    email: str(b[`guest_${n}_email`]),
    ownBidderNumber: isYes(b[`guest_${n}_own_number`]),
  }));
  return {
    entryId: str(b.entry_id),
    firstName: str(b.first_name),
    lastName: str(b.last_name),
    email: str(b.email),
    phone: str(b.phone),
    tickets: wholeNumber(b.tickets),
    guests,
    paymentMethod: str(b.payment_method),
    paymentStatus: str(b.payment_status),
    total: money(b.payment_total),
    transactionId: str(b.transaction_id),
  };
}
