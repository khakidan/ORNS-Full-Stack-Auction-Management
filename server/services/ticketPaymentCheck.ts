import { sheets_v4 } from "googleapis";
import { getSharedConfig } from "./configService";
import { getAdminFirestore } from "./firebaseAdmin";
import { logSystemAction } from "./actionLog";
import { FluentFormsApi, FluentFormsTransaction } from "./fluentFormsApi";
import { PayPalService, PayPalPayment } from "./paypalService";
import { FLUENT_FORMS, TICKETS_TAB, clearReview, findEntryRow, flagForReview } from "./ticketPurchaseService";
import { withLock } from "../utils/asyncLock";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";
import { TICKETS_COL } from "../utils/sheetColumns";

/** Which entry each confirmed PayPal payment paid for - one payment can't mark two purchases paid. */
const CHARGES = () => getAdminFirestore().collection("ticketPaymentCharges");
const STATUS_COLUMN = "U";

export type TicketPaymentOutcome =
  /** No row with this entry ID yet (shadow mode, or the purchase is still on its way). */
  | { outcome: "no-row"; entryId: string }
  /** Not a PayPal purchase: cash/check is recorded by staff in the app. */
  | { outcome: "offline"; entryId: string; status: string }
  /** Nothing to change (already Paid, or not paid yet). */
  | { outcome: "unchanged"; entryId: string; status: string; reason: string }
  /** Column U set (write mode), or would be (compare mode). */
  | { outcome: "set" | "would-set"; entryId: string; from: string; to: "Paid" | "Refunded"; transactionId: string }
  /** Can't be confirmed as it stands; on the review list for staff (write mode). */
  | { outcome: "needs-review"; entryId: string; problems: string[] };

export interface TicketPaymentDeps {
  fluentForms: Pick<FluentFormsApi, "getEntryPayment">;
  paypal: Pick<PayPalService, "getPayment">;
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const isRefund = (t: FluentFormsTransaction) => t.status === "refunded" || t.status === "partially-refunded";

/**
 * Sets a website ticket purchase's payment status (column U) from the
 * payment itself, not the form (ROADMAP W4). The webhook (W3) calls it
 * after each delivery and the poll (W5) for rows still Pending; neither
 * can mark a ticket paid on its own say-so.
 *
 * - Only PayPal purchases are checked. Cash/check stays Pending until
 *   staff record it in the app (Fluent Forms will go on saying pending).
 * - Paid needs Fluent Forms to say paid AND PayPal to confirm that
 *   transaction ID: completed, in USD, for the amount Fluent Forms
 *   recorded, and not already used for another entry. The transaction ID
 *   comes from Fluent Forms' REST API, since the webhook can't send it.
 * - A row is never moved from Paid back to Pending. A full refund that
 *   PayPal confirms sets it to Refunded; every refund goes on the review
 *   list, since the bidder may need re-invoicing or removing.
 * - Anything it can't confirm goes on the review list instead.
 *
 * Runs under the same per-entry lock as upsertTicketPurchase. In compare
 * mode (shadow) it reports and writes nothing.
 */
export async function checkTicketPayment(
  sheets: sheets_v4.Sheets,
  entryId: string,
  { mode, fluentForms, paypal }: TicketPaymentDeps & { mode: "write" | "compare" }
): Promise<TicketPaymentOutcome> {
  const spreadsheetId = (await getSharedConfig()).auctionTicketsSpreadsheetId;
  if (!spreadsheetId) throw new Error("The Auction Tickets Spreadsheet ID isn't set in Settings.");

  return withLock(`ticket-entry:${entryId}`, async () => {
    const rowIndex = await findEntryRow(sheets, spreadsheetId, entryId);
    if (rowIndex === null) return { outcome: "no-row", entryId };
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TICKETS_TAB}!A${rowIndex}:W${rowIndex}` });
    const row = res.data.values?.[0] || [];
    const cell = (i: number) => String(row[i] ?? "").trim();
    const name = `${cell(TICKETS_COL.firstName)} ${cell(TICKETS_COL.lastName)}`.trim();
    const status = cell(TICKETS_COL.paymentStatus) || "Pending";
    if (cell(TICKETS_COL.paymentMethod).toLowerCase() !== "paypal") return { outcome: "offline", entryId, status };

    const review = async (problems: string[]): Promise<TicketPaymentOutcome> => {
      if (mode === "write") await flagForReview(entryId, name, problems);
      return { outcome: "needs-review", entryId, problems };
    };
    const setStatus = async (to: "Paid" | "Refunded", transactionId: string, summary: string): Promise<TicketPaymentOutcome> => {
      if (mode === "compare") return { outcome: "would-set", entryId, from: status, to, transactionId };
      const location = `${TICKETS_TAB}!${STATUS_COLUMN}${rowIndex}`;
      await sheets.spreadsheets.values.update({ spreadsheetId, range: location, valueInputOption: "RAW", requestBody: { values: [[to]] } });
      clearCacheForSpreadsheet(spreadsheetId);
      await logSystemAction(sheets, FLUENT_FORMS, {
        area: "Tickets",
        action: to === "Paid" ? "Confirm ticket payment" : "Record ticket refund",
        target: name,
        summary,
        before: [status],
        after: [to],
        location: `Auction Tickets ${location}`,
        notUndoableReason: "it was read from PayPal, which would set it again; change the payment status in the app if it's wrong",
      });
      return { outcome: "set", entryId, from: status, to, transactionId };
    };

    const payment = await fluentForms.getEntryPayment(entryId);
    const paypalTransactions = payment.transactions.filter((t) => t.paymentMethod === "paypal");

    if (payment.refunds.length > 0 || paypalTransactions.some(isRefund)) {
      if (status === "Refunded") return { outcome: "unchanged", entryId, status, reason: "already Refunded" };
      const refunded = paypalTransactions.find((t) => t.chargeId);
      const atPayPal = refunded ? await paypal.getPayment(refunded.chargeId, new Date(refunded.createdAt)) : null;
      if (refunded && atPayPal?.status === "REFUNDED") {
        if (mode === "write") await flagForReview(entryId, name, [`Refunded in PayPal (payment ${refunded.chargeId}) - check whether this bidder still needs a number, or an invoice.`]);
        return setStatus("Refunded", refunded.chargeId, `Marked ${name}'s ticket purchase Refunded: PayPal reports payment ${refunded.chargeId} refunded (Fluent Forms entry ${entryId})`);
      }
      return review([`Fluent Forms shows a refund, but PayPal says ${atPayPal ? atPayPal.status : "nothing"} for ${refunded?.chargeId || "this entry (no transaction ID)"} - check it in PayPal and set the status in the app.`]);
    }

    if (status === "Paid") return { outcome: "unchanged", entryId, status, reason: "already Paid" };
    const paid = paypalTransactions.find((t) => t.status === "paid");
    if (!paid) {
      const said = paypalTransactions.map((t) => t.status).join(", ") || "no payment yet";
      return { outcome: "unchanged", entryId, status, reason: `Fluent Forms says ${said}` };
    }
    if (!paid.chargeId) return review(["Fluent Forms says paid but has no PayPal transaction ID - check it in PayPal and set the status in the app."]);

    const atPayPal: PayPalPayment | null = await paypal.getPayment(paid.chargeId, new Date(paid.createdAt));
    if (!atPayPal) return review([`PayPal has no payment ${paid.chargeId} - check it in PayPal and set the status in the app.`]);
    if (atPayPal.status === "PENDING") return { outcome: "unchanged", entryId, status, reason: `PayPal payment ${paid.chargeId} is still pending` };
    const problems: string[] = [];
    if (atPayPal.status !== "COMPLETED") problems.push(`PayPal says payment ${paid.chargeId} is ${atPayPal.status}, not completed.`);
    if (atPayPal.currency !== "USD" || !(Math.abs(atPayPal.amount - paid.total) < 0.005)) {
      problems.push(`PayPal's payment is ${money(atPayPal.amount)} ${atPayPal.currency}, but Fluent Forms recorded ${money(paid.total)} ${paid.currency || "USD"}.`);
    }
    const claimedBy = (await CHARGES().doc(paid.chargeId).get()).data()?.entryId;
    if (claimedBy && claimedBy !== entryId) problems.push(`PayPal payment ${paid.chargeId} already paid for Fluent Forms entry ${claimedBy}.`);
    if (problems.length > 0) return review(problems);

    const result = await setStatus("Paid", paid.chargeId, `Marked ${name}'s ticket purchase Paid: PayPal confirmed payment ${paid.chargeId} for ${money(atPayPal.amount)} (Fluent Forms entry ${entryId})`);
    if (mode === "write") {
      await CHARGES().doc(paid.chargeId).set({ entryId, at: new Date().toISOString() });
      await clearReview(entryId);
    }
    return result;
  });
}
