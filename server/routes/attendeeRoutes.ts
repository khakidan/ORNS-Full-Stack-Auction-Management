import { Router, Request, Response, NextFunction } from 'express';
import { fromConfig, TICKET_FIELDS } from '../middleware/fromConfig';
import { requirePermission } from '../middleware/requirePermission';
import { sheetsFor } from '../utils/googleClients';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { IDEMPOTENT_POST_RETRY } from '../utils/googleRetry';
import { logAction } from '../services/actionLog';
import { syncBiddersFromTickets } from '../services/bidderTicketSync';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { getSharedConfig } from '../services/configService';
import { parseAttendeeRows } from '../../src/lib/attendeeParsing';
import { Attendee } from '../../src/types';
import type { AddAttendeeRequest, DeleteAttendeeRequest, UpdateAttendeeRequest } from "../../shared/apiTypes";

/** The Auction Tickets spreadsheet's attendee tabs. */
export const TICKET_SHEETS = ["tickets", "staff tickets", "sponsor tickets"];

/** "F57" or "H57:K57" - cells within one data row (2 or later). Returns that row, or null. */
function singleRowOf(cells: string): number | null {
  const m = /^[A-Z]{1,3}(\d+)(?::[A-Z]{1,3}(\d+))?$/.exec(cells);
  if (!m) return null;
  const row = Number(m[1]);
  if (m[2] !== undefined && Number(m[2]) !== row) return null;
  return row >= 2 ? row : null;
}

/** Splits "tickets!F57" or "'staff tickets'!H57:K57" into a ticket tab and its cells. */
function parseTicketRange(range: unknown): { sheet: string; cells: string; row: number } | null {
  if (typeof range !== "string") return null;
  const bang = range.lastIndexOf("!");
  if (bang === -1) return null;
  const sheet = range.slice(0, bang).trim().replace(/^'(.*)'$/, "$1");
  const cells = range.slice(bang + 1).trim().toUpperCase();
  const row = singleRowOf(cells);
  if (!TICKET_SHEETS.includes(sheet) || row === null) return null;
  return { sheet, cells, row };
}

/**
 * Attendee List changes. They go through here, not the generic sheets
 * proxy (which refuses the ticket tabs), so each one is recorded in Action
 * History with what it replaced, and deleting checks its permission.
 */
/**
 * What a volunteer's Bid Management screens need from a ticket: which
 * ticket it is, the names (to match bidders and guests) and whether it's
 * paid - for the Bidders tab's Staff/Paid badges and checkout's ticket
 * link. No email, phone, payment method or amount (ROADMAP B4).
 */
export function badgeFields(a: Attendee): Attendee {
  return {
    ...a,
    email: "",
    phone: "",
    ticketsPurchased: "",
    paymentMethod: "",
    totalPaid: "",
    formEntryId: "",
    guestsInfo: a.guestsInfo.map((g) => ({ ...g, email: "" })),
  };
}

export default function createAttendeeRouter() {
  const router = Router();

  /**
   * The ticket list with only the badge fields, for volunteers (who can't
   * read the ticket spreadsheet itself - volunteerAccess.ts). Always this
   * year's Tickets spreadsheet, from the Config.
   */
  router.get("/attendees/badges", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const spreadsheetId = (await getSharedConfig()).auctionTicketsSpreadsheetId;
      if (!spreadsheetId) return res.json({ attendees: [] });
      const sheets = sheetsFor(req);
      const attendees: Attendee[] = [];
      for (const sheet of TICKET_SHEETS) {
        const data = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheet}'!A:Z` }).catch(() => null);
        const values = (data?.data.values || []) as string[][];
        if (values.length > 1) attendees.push(...parseAttendeeRows(sheet, values).map(badgeFields));
      }
      res.json({ attendees });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Appends an attendee row. The browser resends after a 5xx or a dropped
   * connection (fetchWithRetry), and a second append would add the person
   * twice, so the request's `idempotencyKey` makes a resend return the
   * first result instead (ROADMAP A4).
   */
  router.post("/attendees/add", requirePermission("tickets.edit"), fromConfig(TICKET_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, sheet, row, idempotencyKey } = (req.body || {}) as Partial<AddAttendeeRequest>;
    if (!spreadsheetId || !TICKET_SHEETS.includes(sheet) || !Array.isArray(row)) {
      return res.status(400).json({ error: "spreadsheetId, a ticket sheet name and the new row are required." });
    }
    try {
      const outcome = await withIdempotency("attendees/add", idempotencyKey, async () => {
        const result = await sheetsFor(req).spreadsheets.values.append({
          spreadsheetId,
          range: `'${sheet}'!A:A`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [row] },
        });
        clearCacheForSpreadsheet(spreadsheetId);
        const written = result.data.updates?.updatedRange;
        await logAction(req, {
          area: "Tickets",
          action: "Add attendee",
          target: `${row[0] ?? ""} ${row[1] ?? ""}`.trim(),
          summary: `Added ${`${row[0] ?? ""} ${row[1] ?? ""}`.trim() || "an attendee"} to ${sheet}`,
          after: row,
          location: `Auction Tickets ${written || sheet}`,
          ...(written
            ? { undo: { kind: "cells" as const, spreadsheetId, range: written, before: [row.map(() => "")], after: [row] } }
            : { notUndoableReason: "the sheet didn't say which row it was added to" }),
        });
        // The bidder follows their ticket (bidderTicketSync.ts).
        await syncBiddersFromTickets(req);
        return result.data;
      });
      res.json(idempotentBody(outcome));
    } catch (error) {
      next(error);
    }
  });

  router.post("/attendees/update", requirePermission("tickets.edit"), fromConfig(TICKET_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, range, values } = (req.body || {}) as Partial<UpdateAttendeeRequest>;
    const target = parseTicketRange(range);
    if (!spreadsheetId || !target || !Array.isArray(values) || values.length !== 1 || !Array.isArray(values[0])) {
      return res.status(400).json({ error: "spreadsheetId, cells in one row of a ticket sheet, and one row of values are required." });
    }
    const a1 = `'${target.sheet}'!${target.cells}`;
    try {
      const sheets = sheetsFor(req);
      const old = await sheets.spreadsheets.values.get({ spreadsheetId, range: a1, valueRenderOption: "UNFORMATTED_VALUE" });
      const before = [values[0].map((_: unknown, i: number) => old.data.values?.[0]?.[i] ?? "")];
      const result = await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: a1,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
      clearCacheForSpreadsheet(spreadsheetId);
      await logAction(req, {
        area: "Tickets",
        action: "Edit attendee",
        target: `${target.sheet} row ${target.row}`,
        summary: `Edited ${target.sheet} row ${target.row} (${target.cells})`,
        before: before[0],
        after: values[0],
        location: `Auction Tickets ${a1}`,
        undo: { kind: "cells", spreadsheetId, range: a1, before, after: values },
      });
      // The bidder follows their ticket (bidderTicketSync.ts).
      await syncBiddersFromTickets(req);
      res.json(result.data);
    } catch (error) {
      next(error);
    }
  });

  /**
   * Deletes an attendee by clearing their row (Administrators and up - the
   * generic sheets proxy refuses the ticket tabs, so this permission can't
   * be bypassed).
   */
  router.post("/attendees/delete", requirePermission("attendees.delete"), fromConfig(TICKET_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, sheet, rowIndex } = (req.body || {}) as Partial<DeleteAttendeeRequest>;
    if (!spreadsheetId || !TICKET_SHEETS.includes(sheet) || !Number.isInteger(rowIndex) || rowIndex < 2) {
      return res.status(400).json({ error: "spreadsheetId, a ticket sheet name and a data row number are required." });
    }
    const a1 = `'${sheet}'!A${rowIndex}:Z${rowIndex}`;
    try {
      const sheets = sheetsFor(req);
      const old = await sheets.spreadsheets.values.get({ spreadsheetId, range: a1, valueRenderOption: "UNFORMATTED_VALUE" });
      const before = (old.data.values?.[0] || []) as unknown[];
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: a1 }, IDEMPOTENT_POST_RETRY);
      clearCacheForSpreadsheet(spreadsheetId);
      await logAction(req, {
        area: "Tickets",
        action: "Delete attendee",
        target: `${before[0] ?? ""} ${before[1] ?? ""}`.trim() || `${sheet} row ${rowIndex}`,
        summary: `Deleted ${`${before[0] ?? ""} ${before[1] ?? ""}`.trim() || "an attendee"} from ${sheet} (row ${rowIndex})`,
        before,
        location: `Auction Tickets ${a1}`,
        undo: { kind: "cells", spreadsheetId, range: a1, before: [before], after: [[]] },
      });
      await syncBiddersFromTickets(req);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
