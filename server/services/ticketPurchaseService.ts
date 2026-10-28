import { sheets_v4 } from "googleapis";
import { getSharedConfig } from "./configService";
import { getAdminFirestore } from "./firebaseAdmin";
import { logSystemAction } from "./actionLog";
import { syncBiddersWith } from "./bidderTicketSync";
import { TicketPurchase, ticketRowFromPurchase } from "./ticketPurchaseRow";
import { withLock } from "../utils/asyncLock";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";
import { TICKETS_COL } from "../utils/sheetColumns";
import { FORM_ENTRY_ID_COLUMN } from "../../src/lib/attendeeSheetColumns";

/** Who Action History says made these rows. */
export const FLUENT_FORMS = "Fluent Forms (website)";
export const TICKETS_TAB = "'tickets'";
const REVIEW = () => getAdminFirestore().collection("ticketPurchaseReview");

/**
 * "write" once the switch-over is made (ROADMAP rollout step 3); until
 * then "compare" - the shadow mode, which reports and writes nothing. The
 * webhook (W3) and the poll (W5) both follow it.
 */
export function ticketWriteMode(): "write" | "compare" {
  return process.env.FLUENT_FORMS_TICKETS_MODE?.trim().toLowerCase() === "write" ? "write" : "compare";
}

export type TicketPurchaseOutcome =
  /** Appended to the tickets tab. */
  | { outcome: "added"; entryId: string; rowIndex: number | null }
  /** Already has a row (matched by entry ID) - left as it is. */
  | { outcome: "exists"; entryId: string; rowIndex: number }
  /** Can't be written as it stands; on the review list for staff. */
  | { outcome: "needs-review"; entryId: string; problems: string[] }
  /** Compare mode: would have been appended. */
  | { outcome: "would-add"; entryId: string; row: (string | number)[] };

/**
 * Makes sure one website ticket purchase has its row on the Auction
 * Tickets spreadsheet's `tickets` tab - the one function both the webhook
 * (ROADMAP W3) and the poll (W5) use, so a purchase is written one way
 * and never twice (W2).
 *
 * - The row is found by its Fluent Forms entry ID (column W, W1), under a
 *   lock per entry, so a webhook and a poll arriving together can't both
 *   add it.
 * - A row that already exists is left alone: staff may have corrected it
 *   since, and their edits win. Payment changes are W4's job.
 * - A purchase that can't be written as it stands (ticketRowFromPurchase)
 *   goes on the `ticketPurchaseReview` list in Firestore for staff instead
 *   of into the sheet half right.
 * - A new row is in Action History as "Fluent Forms (website)", tells open
 *   screens (clearCacheForSpreadsheet), and becomes a bidder while the
 *   auction is in Prep (syncBiddersWith).
 *
 * `mode: "compare"` (the rollout's shadow mode) reports what would happen
 * and writes nothing - not the sheet, not the review list.
 *
 * `sheets` is the server's own Google access (the PayPal sweeper's stored
 * sign-in), since no person is asking.
 */
export async function upsertTicketPurchase(
  sheets: sheets_v4.Sheets,
  purchase: TicketPurchase,
  { mode }: { mode: "write" | "compare" }
): Promise<TicketPurchaseOutcome> {
  const entryId = String(purchase.entryId ?? "").trim();
  const built = ticketRowFromPurchase(purchase);
  if ("problems" in built) {
    if (mode === "write") await putOnReviewList(purchase, built.problems);
    return { outcome: "needs-review", entryId, problems: built.problems };
  }

  const spreadsheetId = (await getSharedConfig()).auctionTicketsSpreadsheetId;
  if (!spreadsheetId) throw new Error("The Auction Tickets Spreadsheet ID isn't set in Settings.");

  return withLock(`ticket-entry:${entryId}`, async () => {
    const rowIndex = await findEntryRow(sheets, spreadsheetId, entryId);
    if (rowIndex !== null) return { outcome: "exists", entryId, rowIndex };
    if (mode === "compare") return { outcome: "would-add", entryId, row: built.row };

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${TICKETS_TAB}!A:A`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [built.row] },
    });
    clearCacheForSpreadsheet(spreadsheetId);
    const written = result.data.updates?.updatedRange || null;
    const name = `${purchase.firstName} ${purchase.lastName}`.trim();
    await logSystemAction(sheets, FLUENT_FORMS, {
      area: "Tickets",
      action: "Add ticket purchase",
      target: name,
      summary: `Added ${name}'s website purchase: ${purchase.tickets} ticket(s), ${built.row[TICKETS_COL.paymentStatus]} (Fluent Forms entry ${entryId})`,
      after: built.row,
      location: `Auction Tickets ${written || "'tickets'"}`,
      notUndoableReason: "the purchase is still in Fluent Forms, so it would be added again; edit or delete the ticket in the app instead",
    });
    await clearReview(entryId);
    await syncBiddersWith(sheets, (entry) => logSystemAction(sheets, FLUENT_FORMS, entry));
    return { outcome: "added", entryId, rowIndex: rowNumberOf(written) };
  });
}

/** The 1-based row whose column W holds `entryId`, or null. */
export async function findEntryRow(sheets: sheets_v4.Sheets, spreadsheetId: string, entryId: string): Promise<number | null> {
  const column = FORM_ENTRY_ID_COLUMN.letter;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TICKETS_TAB}!${column}:${column}` });
  const values = res.data.values || [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i]?.[0] ?? "").trim() === entryId) return i + 1;
  }
  return null;
}

/** "'tickets'!A57:W57" -> 57. */
function rowNumberOf(range: string | null): number | null {
  const match = range && /![A-Z]+(\d+)/.exec(range);
  return match ? Number(match[1]) : null;
}

/**
 * Keeps only what staff need to find the entry in Fluent Forms: its ID,
 * the buyer's name and what's wrong. The full purchase stays in WordPress.
 */
async function putOnReviewList(purchase: TicketPurchase, problems: string[]): Promise<void> {
  await flagForReview(String(purchase.entryId ?? "").trim(), `${purchase.firstName ?? ""} ${purchase.lastName ?? ""}`, problems);
}

/**
 * Puts an entry on the `ticketPurchaseReview` list for staff (W2's rows
 * that can't be written, W4's payments that can't be confirmed).
 */
export async function flagForReview(entryId: string, name: string, problems: string[]): Promise<void> {
  const now = new Date().toISOString();
  const doc = REVIEW().doc(/^\d+$/.test(entryId) ? entryId : `no-entry-id-${now}`);
  const existing = (await doc.get()).data();
  await doc.set({
    entryId,
    name: name.trim().slice(0, 200),
    problems,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
  });
}

export interface TicketReviewItem {
  entryId: string;
  name: string;
  problems: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/** The review list, oldest first - for the Tickets page's status card (W6). */
export async function listReview(): Promise<TicketReviewItem[]> {
  const snapshot = await REVIEW().get();
  return snapshot.docs
    .map((doc) => doc.data() as TicketReviewItem)
    .sort((a, b) => String(a.firstSeenAt).localeCompare(String(b.firstSeenAt)));
}

/** Takes an entry off the review list once it's sorted. */
export async function clearReview(entryId: string): Promise<void> {
  await REVIEW().doc(entryId).delete().catch(() => {});
}
