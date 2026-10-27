import { Request } from "express";
import { sheets_v4 } from "googleapis";
import { sheetsFor } from "../utils/googleClients";
import { getSharedConfig } from "./configService";
import { logAction } from "./actionLog";
import { withLock } from "../utils/asyncLock";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";
import { BIDDER_COL } from "../utils/sheetColumns";
import { findBidderColumn } from "../utils/bidGrid";
import { getColumnLetter } from "../utils/columnUtils";
import { ensureTrackingHeaders } from "../utils/bidderNumbersHeaders";
import { fetchTicketSheetRows } from "./syncService";
import { TicketPerson, bidderEmail, bidderName, collectTicketPeople } from "./ticketPeople";

/**
 * Keeps every bidder's name and email the same as their ticket's. The
 * Auction Tickets spreadsheet is the source of truth; Bidder-Numbers B-D
 * and the Bid-Management grid's name row (row 2) are copies.
 *
 * Each bidder is tied to their ticket by Bidder-Numbers column O (written
 * by Set Up, ticketPeople.ts). A bidder without one - set up before the
 * column existed, or a walk-in whose ticket was added after them - is tied
 * to the one ticket person with the same email, or failing that the same
 * name, if exactly one matches.
 *
 * A tie is trusted while the ticket still shares the bidder's email or
 * name (an edit changes one at a time), or when nobody else claims that
 * ticket person (both were changed directly in the sheet). It is dropped
 * when the row now holds exactly another bidder - rows were sorted or
 * moved by hand - and the bidder is matched again. A ticket that has been
 * cleared never blanks a bidder.
 *
 * Runs after every ticket change made in the app, when Bid Management
 * loads, before receipts, labels and checkout use bidder names, and about
 * once a minute while anyone has the app open (to catch edits made
 * directly in the spreadsheet) - see syncBiddersFromTickets below.
 */

export interface BidderRename {
  id: string;
  before: { firstName: string; lastName: string; email: string };
  after: { firstName: string; lastName: string; email: string };
}

interface BidderLine {
  id: string;
  rowNumber: number;
  firstName: string;
  lastName: string;
  email: string;
  ref: string;
}

const fullName = (first: string, last: string) => `${first} ${last}`.trim().toLowerCase();
const personName = (p: TicketPerson) => fullName(bidderName(p.firstName), bidderName(p.lastName));
const sharesEmail = (p: TicketPerson, b: BidderLine) => !!bidderEmail(p.email) && bidderEmail(p.email) === bidderEmail(b.email);
const sharesName = (p: TicketPerson, b: BidderLine) => !!personName(p) && personName(p) === fullName(b.firstName, b.lastName);
const isExactly = (p: TicketPerson, b: BidderLine) => sharesName(p, b) && bidderEmail(p.email) === bidderEmail(b.email);

/** The single ticket person matching `test`, or undefined when none or several do. */
function onlyOne(people: TicketPerson[], test: (p: TicketPerson) => boolean): TicketPerson | undefined {
  const found = people.filter(test);
  return found.length === 1 ? found[0] : undefined;
}

/**
 * Pure: which bidders to tie to which ticket person, and which need their
 * name or email brought in line. Exported for tests.
 */
export function planBidderSync(bidders: BidderLine[], people: TicketPerson[]): { bidder: BidderLine; person: TicketPerson }[] {
  const byRef = new Map(people.map((p) => [p.ref, p]));
  const taken = new Set<string>();
  const tied = new Map<string, TicketPerson>();

  // 1. Ties already recorded, unless the row now plainly belongs to someone else.
  for (const b of bidders) {
    const p = b.ref ? byRef.get(b.ref) : undefined;
    if (!p || taken.has(p.ref)) continue;
    const holdsSomeoneElse = !sharesEmail(p, b) && !sharesName(p, b) && bidders.some((other) => other !== b && isExactly(p, other));
    if (holdsSomeoneElse) continue;
    tied.set(b.id, p);
    taken.add(p.ref);
  }

  // 2. Bidders without a (usable) tie: the one free ticket person with the same email, else the same name.
  for (const b of bidders) {
    if (tied.has(b.id)) continue;
    const free = people.filter((p) => !taken.has(p.ref));
    const p = onlyOne(free, (q) => sharesEmail(q, b)) ?? onlyOne(free, (q) => sharesName(q, b));
    if (!p) continue;
    tied.set(b.id, p);
    taken.add(p.ref);
  }

  return bidders.flatMap((b) => {
    const p = tied.get(b.id);
    return p ? [{ bidder: b, person: p }] : [];
  });
}

/**
 * Brings Bidder-Numbers and the grid's name row in line with the tickets.
 * Returns what changed (empty when everything already matched - then
 * nothing is written).
 */
export async function syncBidderNamesWithTickets(
  sheets: sheets_v4.Sheets,
  params: { spreadsheetId: string; ticketsSpreadsheetId: string; bidderNumbersSheet: string; bidManagementSheet: string }
): Promise<BidderRename[]> {
  const { spreadsheetId, ticketsSpreadsheetId, bidderNumbersSheet, bidManagementSheet } = params;
  // Read the tickets before taking the lock - they aren't the locked resource.
  const { staffRows, ticketsRows, sponsorRows } = await fetchTicketSheetRows(sheets, ticketsSpreadsheetId);
  const people = collectTicketPeople(staffRows, ticketsRows, sponsorRows);

  return withLock(`bidder-numbers:${spreadsheetId}`, async () => {
    const bnRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidderNumbersSheet}'!A:O` });
    const bidders: BidderLine[] = (bnRes.data.values || []).slice(1).flatMap((row, i) => {
      const id = String(row[BIDDER_COL.id] ?? "").trim();
      return id ? [{
        id,
        rowNumber: i + 2,
        firstName: String(row[BIDDER_COL.firstName] ?? ""),
        lastName: String(row[BIDDER_COL.lastName] ?? ""),
        email: String(row[BIDDER_COL.email] ?? ""),
        ref: String(row[BIDDER_COL.ticketRef] ?? "").trim(),
      }] : [];
    });

    const renames: BidderRename[] = [];
    const writes: sheets_v4.Schema$ValueRange[] = [];
    const gridNames: { id: string; firstName: string; lastName: string }[] = [];
    for (const { bidder, person } of planBidderSync(bidders, people)) {
      const after = { firstName: bidderName(person.firstName), lastName: bidderName(person.lastName), email: bidderEmail(person.email) };
      // A cleared ticket never blanks a bidder.
      if (!after.firstName && !after.lastName) continue;
      if (after.firstName !== bidder.firstName || after.lastName !== bidder.lastName || after.email !== bidder.email) {
        writes.push({ range: `'${bidderNumbersSheet}'!B${bidder.rowNumber}:D${bidder.rowNumber}`, values: [[after.firstName, after.lastName, after.email]] });
        renames.push({ id: bidder.id, before: { firstName: bidder.firstName, lastName: bidder.lastName, email: bidder.email }, after });
        if (after.firstName !== bidder.firstName || after.lastName !== bidder.lastName) gridNames.push({ id: bidder.id, ...after });
      }
      if (person.ref !== bidder.ref) {
        writes.push({ range: `'${bidderNumbersSheet}'!O${bidder.rowNumber}`, values: [[person.ref]] });
      }
    }
    if (writes.length === 0) return [];

    if (gridNames.length) {
      const gridRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidManagementSheet}'!1:2` });
      for (const g of gridNames) {
        const col = findBidderColumn(gridRes.data.values || [], g.id);
        if (col < 0) continue;
        writes.push({ range: `'${bidManagementSheet}'!${getColumnLetter(col)}2:${getColumnLetter(col + 1)}2`, values: [[g.firstName, g.lastName]] });
      }
    }

    await ensureTrackingHeaders(sheets, spreadsheetId, bidderNumbersSheet).catch((e) => console.warn("[bidderTicketSync] Could not label Bidder-Numbers L1:O1:", e?.message || e));
    // RAW: names are typed by people and must never be read as formulas.
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: writes } });
    clearCacheForSpreadsheet(spreadsheetId);
    return renames;
  });
}

// ---- When it runs -------------------------------------------------------

/** The background run (from the change-feed poll) happens at most this often. */
export const BACKGROUND_SYNC_INTERVAL_MS = 60 * 1000;
let lastBackgroundRunAt = -Infinity;

/**
 * Runs the sync for the auction in the shared Config, as the person
 * asking (their Google access; a volunteer's is the volunteer account's).
 * Never throws - a failed sync must not fail the action that triggered
 * it; the next trigger tries again. Renames are recorded in Action
 * History.
 *
 * `background`: the change-feed poll's call - skipped unless a minute has
 * passed since the last one.
 */
export async function syncBiddersFromTickets(req: Request, options: { background?: boolean } = {}): Promise<BidderRename[]> {
  if (options.background) {
    const now = Date.now();
    if (now - lastBackgroundRunAt < BACKGROUND_SYNC_INTERVAL_MS) return [];
    lastBackgroundRunAt = now;
  }
  try {
    const config = await getSharedConfig();
    if (!config.bidManagementSpreadsheetId || !config.auctionTicketsSpreadsheetId) return [];
    const renames = await syncBidderNamesWithTickets(sheetsFor(req), {
      spreadsheetId: config.bidManagementSpreadsheetId,
      ticketsSpreadsheetId: config.auctionTicketsSpreadsheetId,
      bidderNumbersSheet: config.bidderNumbersSheet,
      bidManagementSheet: config.bidManagementSheet,
    });
    if (renames.length) {
      const describe = (n: BidderRename["before"]) => `${`${n.firstName} ${n.lastName}`.trim()} <${n.email}>`;
      await logAction(req, {
        area: "Bid Management",
        action: "Update bidders from tickets",
        target: renames.map((r) => `Bidder ${r.id}`).join(", "),
        summary: renames.map((r) => `Bidder ${r.id}: ${describe(r.before)} -> ${describe(r.after)}`).join("; "),
        before: renames.map((r) => ({ id: r.id, ...r.before })),
        after: renames.map((r) => ({ id: r.id, ...r.after })),
        notUndoableReason: "bidders follow their tickets - change the ticket instead",
      });
    }
    return renames;
  } catch (err: any) {
    console.warn("[bidderTicketSync] Couldn't bring bidders in line with the tickets:", err?.message || err);
    return [];
  }
}

/** Test-only. */
export function _resetBidderSyncForTesting(): void {
  lastBackgroundRunAt = -Infinity;
}
