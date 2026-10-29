import { sheets_v4 } from "googleapis";
import { getSharedConfig } from "./configService";
import { getAdminFirestore } from "./firebaseAdmin";
import { TicketPurchase } from "./ticketPurchaseRow";
import { BIDDER_COL } from "../utils/sheetColumns";
import { getColumnLetter } from "../utils/columnUtils";
import { readAuctionState } from "../utils/auctionState";

const AFTER_GO_LIVE = () => getAdminFirestore().collection("ticketPurchasesAfterGoLive");

/** A website purchase that arrived once the auction was Live, still to be registered as a walk-in. */
export interface TicketPurchaseAfterGoLive {
  entryId: string;
  name: string;
  tickets: number;
  /** Guests who asked for their own bidder number - each needs one too. */
  guestsWantingNumbers: string[];
  /** "Pending" = paying cash or check at the door. */
  paymentStatus: string;
  /** The auction's state when the purchase arrived. */
  state: "live" | "closed";
  at: string;
}

/**
 * ROADMAP W7: once the auction is Live, syncBiddersFromTickets no longer
 * adds bidders, so a website purchase arriving then gets a ticket row but
 * no bidder number. This puts it on the Website Ticket Check card for
 * staff to register as a walk-in, instead of leaving it silently held.
 *
 * Called for each purchase the webhook or the poll handles (in both
 * modes - in shadow mode the Sheets feed wrote the row). A purchase whose
 * buyer already has a bidder (bought before Go Live; its row is tied to a
 * Bidder-Numbers line) isn't flagged. Already flagged - or already
 * handled - stays as it is. Returns whether it's on the list.
 */
export async function noteIfAfterGoLive(
  sheets: sheets_v4.Sheets,
  purchase: TicketPurchase,
  rowIndex: number | null
): Promise<boolean> {
  const config = await getSharedConfig();
  if (!config.bidManagementSpreadsheetId) return false;
  // Unreadable (null) counts as not Live: nothing is flagged.
  const state = await readAuctionState(sheets, config.bidManagementSpreadsheetId);
  if (state !== "live" && state !== "closed") return false;

  if (rowIndex !== null) {
    const refColumn = getColumnLetter(BIDDER_COL.ticketRef);
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: config.bidManagementSpreadsheetId, range: `'${config.bidderNumbersSheet}'!${refColumn}:${refColumn}` });
    const refs = new Set((res.data.values || []).map((r) => String(r[0] ?? "").trim()));
    if (refs.has(`tickets!${rowIndex}`)) return false;
  }

  const doc = AFTER_GO_LIVE().doc(purchase.entryId);
  if ((await doc.get()).exists) return true;
  const flagged: TicketPurchaseAfterGoLive = {
    entryId: purchase.entryId,
    name: `${purchase.firstName} ${purchase.lastName}`.trim().slice(0, 200),
    tickets: purchase.tickets,
    guestsWantingNumbers: purchase.guests.filter((g) => g.ownBidderNumber && (g.firstName || g.lastName)).map((g) => `${g.firstName} ${g.lastName}`.trim().slice(0, 200)),
    paymentStatus: purchase.paymentStatus.trim().toLowerCase() === "paid" ? "Paid" : "Pending",
    state,
    at: new Date().toISOString(),
  };
  await doc.set(flagged);
  return true;
}

/** The purchases still to register as walk-ins, oldest first - for the status card. */
export async function listAfterGoLive(): Promise<TicketPurchaseAfterGoLive[]> {
  const snapshot = await AFTER_GO_LIVE().get();
  return snapshot.docs
    .map((d) => d.data())
    .filter((d) => !d.handledAt)
    .map((d) => d as TicketPurchaseAfterGoLive)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** Staff registered the purchase as a walk-in (or decided it needs nothing); null if it isn't on the list. */
export async function markAfterGoLiveHandled(entryId: string, by: string): Promise<TicketPurchaseAfterGoLive | null> {
  if (!/^\d+$/.test(entryId)) return null;
  const doc = AFTER_GO_LIVE().doc(entryId);
  const data = (await doc.get()).data();
  if (!data || data.handledAt) return null;
  await doc.set({ handledAt: new Date().toISOString(), handledBy: by }, { merge: true });
  return data as TicketPurchaseAfterGoLive;
}

/** Setup New Auction Year: last year's list goes. */
export async function clearAfterGoLive(): Promise<void> {
  const snapshot = await AFTER_GO_LIVE().get();
  await Promise.all(snapshot.docs.map((d) => d.ref.delete()));
}
