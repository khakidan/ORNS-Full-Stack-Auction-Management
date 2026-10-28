import { Request } from "express";
import { sheets_v4 } from "googleapis";
import { sheetsFor } from "../utils/googleClients";
import { getSharedConfig } from "./configService";
import { logAction, ActionEntry } from "./actionLog";
import { withLock } from "../utils/asyncLock";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";
import { BIDDER_COL } from "../utils/sheetColumns";
import { findBidderColumn } from "../utils/bidGrid";
import { getColumnLetter } from "../utils/columnUtils";
import { ensureTrackingHeaders } from "../utils/bidderNumbersHeaders";
import { TICKETS_COL, WALK_IN_PAYMENT_METHOD } from "../utils/sheetColumns";
import { AuctionState, parseAuctionState } from "../utils/auctionState";
import { computeBidderNumbersRows, fetchTicketSheetRows } from "./syncService";
import { bidderColumnFormatRequests, nextBidderId, nextColumnPairStart } from "./bidderService";
import { SheetRows, TicketPerson, bidderEmail, bidderName, collectTicketPeople } from "./ticketPeople";

/**
 * Keeps Bidder-Numbers in step with the Auction Tickets spreadsheet, the
 * source of truth: every bidder's name and email (Bidder-Numbers B-D and
 * the Bid-Management grid's name row) are copies of their ticket's - the
 * ticket holder's, or a guest's from their own guest slot.
 *
 * Each bidder is tied to their ticket by Bidder-Numbers column O (written
 * by Set Up, ticketPeople.ts). A bidder without one - set up before the
 * column existed, or a walk-in whose ticket was added after them - is tied
 * to the one ticket person with the same email, or failing that the same
 * name. If neither matches (both were changed before the tie existed),
 * their bidder number decides: Set Up numbers people in a fixed order, so
 * today's tickets say which slot got which number - trusted only when
 * every bidder already tied agrees with that order (it hasn't shifted).
 *
 * A tie is trusted while the ticket still shares the bidder's email or
 * name (an edit changes one at a time), or when nobody else claims that
 * ticket person (both were changed directly in the sheet). It is dropped
 * when the row now holds exactly another bidder - rows were sorted or
 * moved by hand - and the bidder is matched again. A ticket that has been
 * cleared never blanks a bidder.
 *
 * While the auction is in Prep, someone on the tickets with no bidder (a
 * ticket bought after Set Up, a guest who now wants their own number) is
 * added - a new number, a Bidder-Numbers row and a grid column pair - but
 * only when every existing bidder is tied, so a renamed person is never
 * added twice. Never once the auction is Live or Closed.
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

export interface AddedBidder {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  ref: string;
}

export interface BidderSyncResult {
  renamed: BidderRename[];
  added: AddedBidder[];
  /** Bidders still not tied to any ticket (shown on the Bidders tab). */
  unlinked: string[];
}

export const NOTHING_CHANGED: BidderSyncResult = { renamed: [], added: [], unlinked: [] };

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
const personKey = (p: TicketPerson) => `${personName(p)}|${bidderEmail(p.email)}`;

/** The single ticket person matching `test`, or undefined when none or several do. */
function onlyOne(people: TicketPerson[], test: (p: TicketPerson) => boolean): TicketPerson | undefined {
  const found = people.filter(test);
  return found.length === 1 ? found[0] : undefined;
}

export interface BidderSyncPlan {
  ties: { bidder: BidderLine; person: TicketPerson }[];
  /** Bidders tied to no ticket. */
  orphans: BidderLine[];
  /** Ticket people with no bidder, once (the same person listed twice counts once, as in Set Up). */
  newPeople: TicketPerson[];
}

/**
 * Pure: which bidder is which ticket person. `setUpNumbers` is the number
 * Set Up would give each ticket person today (ref -> number). Exported for
 * tests.
 */
export function planBidderSync(bidders: BidderLine[], people: TicketPerson[], setUpNumbers: Map<string, number> = new Map()): BidderSyncPlan {
  const byRef = new Map(people.map((p) => [p.ref, p]));
  const taken = new Set<string>();
  const tied = new Map<string, TicketPerson>();
  const tie = (b: BidderLine, p: TicketPerson) => { tied.set(b.id, p); taken.add(p.ref); };

  // 1. Ties already recorded, unless the row now plainly belongs to someone else.
  for (const b of bidders) {
    const p = b.ref ? byRef.get(b.ref) : undefined;
    if (!p || taken.has(p.ref)) continue;
    const holdsSomeoneElse = !sharesEmail(p, b) && !sharesName(p, b) && bidders.some((other) => other !== b && isExactly(p, other));
    if (!holdsSomeoneElse) tie(b, p);
  }

  // 2. Bidders without a (usable) tie: the one free ticket person with the same email, else the same name.
  for (const b of bidders) {
    if (tied.has(b.id)) continue;
    const free = people.filter((p) => !taken.has(p.ref));
    const p = onlyOne(free, (q) => sharesEmail(q, b)) ?? onlyOne(free, (q) => sharesName(q, b));
    if (p) tie(b, p);
  }

  // 3. Still untied (name and email both changed before the tie existed):
  // the bidder number, if the tied bidders show Set Up's order still holds.
  const orderHolds = tied.size > 0 && [...tied.entries()].every(([id, p]) => {
    const n = setUpNumbers.get(p.ref);
    return n === undefined || n === Number(id);
  });
  if (orderHolds) {
    for (const b of bidders) {
      if (tied.has(b.id)) continue;
      const p = people.find((q) => !taken.has(q.ref) && setUpNumbers.get(q.ref) === Number(b.id));
      if (p) tie(b, p);
    }
  }

  const ties = bidders.flatMap((b) => {
    const p = tied.get(b.id);
    return p ? [{ bidder: b, person: p }] : [];
  });
  const orphans = bidders.filter((b) => !tied.has(b.id));

  // Ticket people nobody is tied to - except a repeat of someone already
  // there (Set Up gives the same name and email one number).
  const seen = new Set(ties.map((t) => personKey(t.person)));
  const newPeople: TicketPerson[] = [];
  for (const p of people) {
    if (taken.has(p.ref) || !personName(p)) continue;
    const key = personKey(p);
    if (seen.has(key) || bidders.some((b) => isExactly(p, b))) continue;
    seen.add(key);
    newPeople.push(p);
  }
  return { ties, orphans, newPeople };
}

/** The number Set Up would give each ticket person today (walk-in tickets left out - Set Up never numbers them). */
function setUpNumbersFor(staffRows: SheetRows, ticketsRows: SheetRows, sponsorRows: SheetRows): Map<string, number> {
  const withoutWalkIns = ticketsRows.map((row, i) =>
    i > 0 && String((row as unknown[])?.[TICKETS_COL.paymentMethod] ?? "").trim() === WALK_IN_PAYMENT_METHOD ? [] : row);
  return new Map(computeBidderNumbersRows(staffRows, withoutWalkIns, sponsorRows).map((r) => [r[BIDDER_COL.ticketRef] as string, r[BIDDER_COL.id] as number]));
}

/**
 * Brings Bidder-Numbers and the grid in line with the tickets: renames,
 * ties, and (in Prep) new bidders. Writes nothing when everything already
 * matches.
 */
export async function syncBidderNamesWithTickets(
  sheets: sheets_v4.Sheets,
  params: { spreadsheetId: string; ticketsSpreadsheetId: string; bidderNumbersSheet: string; bidManagementSheet: string }
): Promise<BidderSyncResult> {
  const { spreadsheetId, ticketsSpreadsheetId, bidderNumbersSheet, bidManagementSheet } = params;
  // Read the tickets before taking the lock - they aren't the locked resource.
  const { staffRows, ticketsRows, sponsorRows } = await fetchTicketSheetRows(sheets, ticketsSpreadsheetId);
  const people = collectTicketPeople(staffRows, ticketsRows, sponsorRows);
  const setUpNumbers = setUpNumbersFor(staffRows, ticketsRows, sponsorRows);

  return withLock(`bidder-numbers:${spreadsheetId}`, async () => {
    const bnRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidderNumbersSheet}'!A:O` });
    const bnRows = bnRes.data.values || [];
    const bidders: BidderLine[] = bnRows.slice(1).flatMap((row, i) => {
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
    // Before Set Up (or bidder labels) has built the list, there's nothing to keep in step.
    if (bidders.length === 0) return NOTHING_CHANGED;

    const plan = planBidderSync(bidders, people, setUpNumbers);
    const renamed: BidderRename[] = [];
    const writes: sheets_v4.Schema$ValueRange[] = [];
    const gridNames: { id: string; firstName: string; lastName: string }[] = [];
    for (const { bidder, person } of plan.ties) {
      const after = { firstName: bidderName(person.firstName), lastName: bidderName(person.lastName), email: bidderEmail(person.email) };
      // A cleared ticket never blanks a bidder.
      if (!after.firstName && !after.lastName) continue;
      if (after.firstName !== bidder.firstName || after.lastName !== bidder.lastName || after.email !== bidder.email) {
        writes.push({ range: `'${bidderNumbersSheet}'!B${bidder.rowNumber}:D${bidder.rowNumber}`, values: [[after.firstName, after.lastName, after.email]] });
        renamed.push({ id: bidder.id, before: { firstName: bidder.firstName, lastName: bidder.lastName, email: bidder.email }, after });
        if (after.firstName !== bidder.firstName || after.lastName !== bidder.lastName) gridNames.push({ id: bidder.id, ...after });
      }
      if (person.ref !== bidder.ref) {
        writes.push({ range: `'${bidderNumbersSheet}'!O${bidder.rowNumber}`, values: [[person.ref]] });
      }
    }

    // New bidders: Prep only, and only when every bidder is accounted for.
    let added: AddedBidder[] = [];
    if (plan.newPeople.length > 0 && plan.orphans.length === 0 && (await auctionStateOf(sheets, spreadsheetId)) === "prep") {
      let nextId = nextBidderId(bnRows);
      added = plan.newPeople.map((p) => ({ id: String(nextId++), firstName: bidderName(p.firstName), lastName: bidderName(p.lastName), email: bidderEmail(p.email), ref: p.ref }));
      const firstNewRow = Math.max(bnRows.length, 1) + 1;
      writes.push({
        range: `'${bidderNumbersSheet}'!A${firstNewRow}:O${firstNewRow + added.length - 1}`,
        values: added.map((a) => [Number(a.id), a.firstName, a.lastName, a.email, false, false, false, false, "", "", "", "", "", "", a.ref]),
      });
    }

    if (writes.length === 0) return { ...NOTHING_CHANGED, unlinked: plan.orphans.map((b) => b.id) };

    const gridTop = (gridNames.length || added.length)
      ? (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidManagementSheet}'!1:5` }).catch(() => null))?.data.values || null
      : null;
    if (gridTop) {
      for (const g of gridNames) {
        const col = findBidderColumn(gridTop, g.id);
        if (col < 0) continue;
        writes.push({ range: `'${bidManagementSheet}'!${getColumnLetter(col)}2:${getColumnLetter(col + 1)}2`, values: [[g.firstName, g.lastName]] });
      }
    }

    await ensureTrackingHeaders(sheets, spreadsheetId, bidderNumbersSheet).catch((e) => console.warn("[bidderTicketSync] Could not label Bidder-Numbers L1:O1:", e?.message || e));
    // RAW: names are typed by people and must never be read as formulas.
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: writes } });
    if (added.length) {
      await setNewBidderCheckboxes(sheets, spreadsheetId, bidderNumbersSheet, Math.max(bnRows.length, 1), added.length);
      // The grid exists once Set Up has run; before that, Set Up builds it.
      if (gridTop) await addGridColumns(sheets, spreadsheetId, bidManagementSheet, gridTop, added);
    }
    clearCacheForSpreadsheet(spreadsheetId);
    return { renamed, added, unlinked: plan.orphans.map((b) => b.id) };
  });
}

/** The auction's state, or null if it can't be read (then nothing is added). */
async function auctionStateOf(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<AuctionState | null> {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Status'!A2", valueRenderOption: "UNFORMATTED_VALUE" });
    return parseAuctionState(res.data.values?.[0]?.[0]);
  } catch {
    return null;
  }
}

/** New rows' E-H as checkboxes, like Set Up's. */
async function setNewBidderCheckboxes(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetName: string, firstRowIndex: number, count: number): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" });
  const sheetId = meta.data.sheets?.find((s) => s.properties?.title === sheetName)?.properties?.sheetId;
  if (sheetId == null) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        setDataValidation: {
          range: { sheetId, startRowIndex: firstRowIndex, endRowIndex: firstRowIndex + count, startColumnIndex: BIDDER_COL.checkedIn, endColumnIndex: BIDDER_COL.paid + 1 },
          rule: { condition: { type: "BOOLEAN" }, showCustomUi: true },
        },
      }],
    },
  });
}

/** Each new bidder's column pair in the grid (ID, name, captions), growing the grid if needed. */
async function addGridColumns(sheets: sheets_v4.Sheets, spreadsheetId: string, gridSheet: string, gridTop: unknown[][], added: AddedBidder[]): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title,gridProperties.columnCount)" });
  const grid = meta.data.sheets?.find((s) => s.properties?.title === gridSheet)?.properties;
  if (!grid) return;
  const startCol = nextColumnPairStart(gridTop);
  const needed = startCol + added.length * 2;
  const have = grid.gridProperties?.columnCount || 0;
  const requests: sheets_v4.Schema$Request[] = [];
  if (have < needed) requests.push({ appendDimension: { sheetId: grid.sheetId, dimension: "COLUMNS", length: needed - have } });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  const ids: (string | number)[] = [];
  const names: string[] = [];
  const captions: string[] = [];
  for (const a of added) {
    ids.push(Number(a.id), "");
    names.push(a.firstName, a.lastName);
    captions.push("Item #:", "Price:");
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${gridSheet}'!${getColumnLetter(startCol)}1:${getColumnLetter(needed - 1)}3`,
    valueInputOption: "RAW",
    requestBody: { values: [ids, names, captions] },
  });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: added.flatMap((_, i) => bidderColumnFormatRequests(grid.sheetId, startCol + i * 2)) },
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
 * it; the next trigger tries again. Renames and added bidders are
 * recorded in Action History.
 *
 * `background`: the change-feed poll's call - skipped unless a minute has
 * passed since the last one.
 */
export async function syncBiddersFromTickets(req: Request, options: { background?: boolean } = {}): Promise<BidderSyncResult> {
  if (options.background) {
    const now = Date.now();
    if (now - lastBackgroundRunAt < BACKGROUND_SYNC_INTERVAL_MS) return NOTHING_CHANGED;
    lastBackgroundRunAt = now;
  }
  return syncBiddersWith(sheetsFor(req), (entry) => logAction(req, entry));
}

/**
 * The same sync for work the server does with no person asking - a ticket
 * bought on the website (ROADMAP W2): `sheets` is the server's own Google
 * access, and `record` writes its Action History rows (logSystemAction).
 * Never throws, like syncBiddersFromTickets.
 */
export async function syncBiddersWith(sheets: sheets_v4.Sheets, record: (entry: ActionEntry) => Promise<void>): Promise<BidderSyncResult> {
  try {
    const config = await getSharedConfig();
    if (!config.bidManagementSpreadsheetId || !config.auctionTicketsSpreadsheetId) return NOTHING_CHANGED;
    const result = await syncBidderNamesWithTickets(sheets, {
      spreadsheetId: config.bidManagementSpreadsheetId,
      ticketsSpreadsheetId: config.auctionTicketsSpreadsheetId,
      bidderNumbersSheet: config.bidderNumbersSheet,
      bidManagementSheet: config.bidManagementSheet,
    });
    const describe = (n: { firstName: string; lastName: string; email: string }) => `${`${n.firstName} ${n.lastName}`.trim()} <${n.email}>`;
    if (result.renamed.length) {
      await record({
        area: "Bid Management",
        action: "Update bidders from tickets",
        target: result.renamed.map((r) => `Bidder ${r.id}`).join(", "),
        summary: result.renamed.map((r) => `Bidder ${r.id}: ${describe(r.before)} -> ${describe(r.after)}`).join("; "),
        before: result.renamed.map((r) => ({ id: r.id, ...r.before })),
        after: result.renamed.map((r) => ({ id: r.id, ...r.after })),
        notUndoableReason: "bidders follow their tickets - change the ticket instead",
      });
    }
    if (result.added.length) {
      await record({
        area: "Bid Management",
        action: "Add bidders from tickets",
        target: result.added.map((a) => `Bidder ${a.id}`).join(", "),
        summary: `New on the tickets since Set Up: ${result.added.map((a) => `Bidder ${a.id} ${describe(a)}`).join("; ")}`,
        after: result.added,
        notUndoableReason: "bidders follow their tickets - remove the ticket (or guest's own number) instead",
      });
    }
    return result;
  } catch (err: any) {
    console.warn("[bidderTicketSync] Couldn't bring bidders in line with the tickets:", err?.message || err);
    return NOTHING_CHANGED;
  }
}

/** Test-only. */
export function _resetBidderSyncForTesting(): void {
  lastBackgroundRunAt = -Infinity;
}
