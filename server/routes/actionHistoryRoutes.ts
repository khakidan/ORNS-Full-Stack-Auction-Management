import { Router, Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission';
import { driveFor, sheetsFor } from '../utils/googleClients';
import { withLock } from '../utils/asyncLock';
import { readUndoData, TrustedSheets } from '../utils/undoData';
import { getActionHistorySpreadsheetId, getEditTrackingRecord, recordUndone, setActionHistorySpreadsheetId, setEditTrackingRecord, wasUndone } from '../services/actionHistoryStore';
import { getSharedConfig } from '../services/configService';
import { createActionHistorySpreadsheet, findAction, listActions, markUndone } from '../services/actionHistoryService';
import { COL } from '../services/actionHistoryRows';
import { applyUndo, UndoRefusedError } from '../services/undoService';
import { ACTION_HISTORY_KEY, announce, noteChange } from '../utils/changeFeed';
import { logAction, ActionArea } from '../services/actionLog';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { runAppsScript } from '../utils/appsScriptRun';
import type { EditTrackingRequest } from "../../shared/apiTypes";

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

/** Where Sheet-edit rows (unsigned Undo Data) may be undone: this year's Items and Tickets spreadsheets. */
async function trustedSheets(): Promise<TrustedSheets> {
  const config = await getSharedConfig();
  return { itemsSpreadsheetId: config.auctionItemsSpreadsheetId, ticketsSpreadsheetId: config.auctionTicketsSpreadsheetId };
}

/** How many actions GET /action-history sends at a time, and at most when asked for more. */
const PAGE_SIZE = 300;
const MAX_PAGE = 1000;

/** Message shown when the signed-in person's Google sign-in predates the trigger permission. */
export const SIGN_IN_AGAIN = "Your Google sign-in doesn't include the permission this needs yet. Sign out, sign in again and approve the new permission, then try again.";

/**
 * Installing a trigger needs the script.scriptapp permission. A sign-in
 * from before it was added gets Google's raw "You do not have permission
 * to call ScriptApp..." (or "The caller does not have permission") - say
 * what to do instead.
 */
function explainScriptError(message: string): string {
  return /script\.scriptapp|permission to call ScriptApp|caller does not have permission/i.test(message) ? SIGN_IN_AGAIN : message;
}

/** Settings > Action History: create the log spreadsheet, read it, and Undo (Administrators - the settings capability). */
export default function createActionHistoryRouter() {
  const router = Router();

  router.get("/action-history/status", requirePermission("settings"), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const spreadsheetId = await getActionHistorySpreadsheetId();
      res.json({ spreadsheetId, url: spreadsheetId ? sheetUrl(spreadsheetId) : "" });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Creates the spreadsheet in the Template Files folder
   * (DRIVE_TEMPLATE_FILES_FOLDER_ID), next to the master Bid Management and
   * Item Entry spreadsheets. Refused while the
   * current one still opens, so the log can't be split by accident; if it
   * was deleted, this makes a new one.
   */
  router.post("/action-history/create", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
    const templateFilesFolderId = process.env.DRIVE_TEMPLATE_FILES_FOLDER_ID;
    if (!templateFilesFolderId) {
      return res.status(500).json({ error: "DRIVE_TEMPLATE_FILES_FOLDER_ID (the Auction/General Auction Info/Template Files folder) is not configured on the server." });
    }
    try {
      const sheets = sheetsFor(req);
      const existing = await getActionHistorySpreadsheetId();
      if (existing) {
        const stillThere = await sheets.spreadsheets.get({ spreadsheetId: existing, fields: "spreadsheetId" }).then(() => true, (e: any) => e?.code !== 404);
        if (stillThere) {
          return res.status(409).json({ error: "The Action History spreadsheet already exists.", spreadsheetId: existing, url: sheetUrl(existing) });
        }
      }
      const spreadsheetId = await createActionHistorySpreadsheet(driveFor(req), sheets, templateFilesFolderId);
      await setActionHistorySpreadsheetId(spreadsheetId, req.user!.email);
      await logAction(req, { area: "Settings", action: "Create Action History spreadsheet", summary: "Started recording actions in a new Action History spreadsheet", notUndoableReason: "the log itself" });
      res.json({ spreadsheetId, url: sheetUrl(spreadsheetId) });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Runs one ActionHistoryTracking.gs function in the Items and Tickets
   * spreadsheets' scripts and collects each one's result. `params` gives
   * each script's arguments, or a reason it can't be run.
   */
  async function runOnTrackedScripts(req: Request, functionName: string, params: (spreadsheetId: string | undefined) => unknown[] | string) {
    const script = google.script({ version: "v1", auth: getAuthenticatedClient(req.session!.tokens!) });
    const { itemsSpreadsheetId, ticketsSpreadsheetId } = (req.body || {}) as Partial<EditTrackingRequest>;
    const targets = [
      { name: "Auction Items", scriptId: process.env.SCRIPT_ID_ITEM_ENTRY, spreadsheetId: itemsSpreadsheetId },
      { name: "Auction Tickets", scriptId: process.env.SCRIPT_ID_TICKETS, spreadsheetId: ticketsSpreadsheetId },
    ];
    const results: { name: string; success: boolean; error?: string; on?: boolean }[] = [];
    for (const t of targets) {
      const args = t.scriptId ? params(t.spreadsheetId) : "Its script ID isn't set on the server.";
      if (typeof args === "string") {
        results.push({ name: t.name, success: false, error: args });
        continue;
      }
      try {
        const result = await runAppsScript(script, t.scriptId!, functionName, args);
        results.push({ name: t.name, success: result?.success !== false, error: result?.error && explainScriptError(result.error), on: result?.on });
      } catch (err: any) {
        results.push({ name: t.name, success: false, error: explainScriptError(err?.message || String(err)) });
      }
    }
    return results;
  }

  /**
   * Whether edits made directly in the Items and Tickets spreadsheets are
   * being recorded. `on` is null when either script couldn't say (not
   * deployed yet, or the sign-in lacks the permission). `turnedOn` says
   * whose on-edit trigger records them, and since when.
   */
  router.get("/action-history/edit-tracking", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const logId = await getActionHistorySpreadsheetId();
      if (!logId) return res.json({ on: false, results: [] });
      const results = await runOnTrackedScripts(req, "apiEditTrackingStatus", () => [logId]);
      res.json({ on: results.every((r) => r.success) ? results.every((r) => r.on) : null, results, turnedOn: await getEditTrackingRecord() });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Turns edit tracking on (`enabled`, the default) or off. On installs the
   * on-edit trigger in the Items and Tickets spreadsheets' scripts
   * (ActionHistoryTracking.gs), owned by the admin who clicks it; off stops
   * every admin's trigger from recording.
   */
  router.post("/action-history/edit-tracking", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
    const enabled = (req.body as Partial<EditTrackingRequest> | undefined)?.enabled !== false;
    try {
      const logId = await getActionHistorySpreadsheetId();
      if (!logId) return res.status(409).json({ error: "Create the Action History spreadsheet first." });
      const results = enabled
        ? await runOnTrackedScripts(req, "apiEnableEditTracking", (spreadsheetId) => (spreadsheetId ? [logId, spreadsheetId] : "Its spreadsheet ID isn't configured."))
        : await runOnTrackedScripts(req, "apiDisableEditTracking", () => []);
      const failures = results.filter((r) => !r.success);
      if (failures.length && failures.every((r) => r.error === SIGN_IN_AGAIN)) {
        return res.status(403).json({ error: SIGN_IN_AGAIN, results });
      }
      if (failures.length === 0) await setEditTrackingRecord(enabled ? { by: req.user!.email, at: new Date().toISOString() } : null);
      await logAction(req, {
        area: "Settings",
        action: enabled ? "Turn on edit tracking" : "Turn off edit tracking",
        summary: `Edit tracking: ${results.map((r) => `${r.name} ${r.success ? (enabled ? "on" : "off") : `failed (${r.error})`}`).join("; ")}`,
        notUndoableReason: `turn it ${enabled ? "off" : "on"} again to change it`,
      });
      res.json({ success: results.every((r) => r.success), results });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The newest actions, a page at a time (ROADMAP A15): `limit` (default
   * PAGE_SIZE, at most MAX_PAGE) actions older than the `before` Action ID
   * (newest first when left out). `total` is how many there are in all;
   * `more` says whether older ones remain. Undo Data is never sent - only
   * `undoPreview`, worked out here from it. If `before` isn't in the log
   * any more (its row was deleted by hand), `restart` tells the browser to
   * load the list again from the top.
   */
  router.get("/action-history", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const spreadsheetId = await getActionHistorySpreadsheetId();
      if (!spreadsheetId) return res.json({ spreadsheetId: "", actions: [], total: 0, more: false });
      const all = await listActions(sheetsFor(req), spreadsheetId, await trustedSheets());
      const requested = Number(req.query.limit);
      const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_PAGE) : PAGE_SIZE;
      const before = typeof req.query.before === "string" ? req.query.before : "";
      const from = before ? all.findIndex((a) => a.id === before) + 1 : 0;
      if (before && from === 0) return res.json({ spreadsheetId, url: sheetUrl(spreadsheetId), actions: [], total: all.length, more: false, restart: true });
      const actions = all.slice(from, from + limit);
      res.json({ spreadsheetId, url: sheetUrl(spreadsheetId), actions, total: all.length, more: from + limit < all.length });
    } catch (error) {
      next(error);
    }
  });

  /** Reverses one action, then marks it "Undone by ..." and records the Undo itself. */
  router.post("/action-history/:actionId/undo", requirePermission("settings"), async (req: Request, res: Response, next: NextFunction) => {
    const { actionId } = req.params;
    try {
      const spreadsheetId = await getActionHistorySpreadsheetId();
      if (!spreadsheetId) return res.status(404).json({ error: "There is no Action History spreadsheet yet." });
      const sheets = sheetsFor(req);

      // One undo of a given action at a time, so two admins can't both reverse it.
      const outcome = await withLock(`action-history-undo:${actionId}`, async () => {
        const found = await findAction(sheets, spreadsheetId, actionId);
        if (!found) return { status: 404, error: "That action isn't in the Action History." };
        const { row, duplicated } = found;
        const cell = (c: number) => String(row[c] ?? "");
        if (duplicated) return { status: 409, error: "More than one row in the Action History has this Action ID, so it can't be undone here." };
        if (cell(COL.undo)) return { status: 409, error: cell(COL.undo).startsWith("Undone") ? `This was already undone (${cell(COL.undo)}).` : cell(COL.undo) };
        if (!cell(COL.undoData)) return { status: 409, error: "This action can't be undone here." };
        // The "Undone by" cell can be cleared by hand; Firestore can't.
        if (await wasUndone(actionId)) return { status: 409, error: "This was already undone." };

        // The spreadsheet is editable by all staff - only act on Undo Data the app wrote (undoData.ts).
        const undoData = readUndoData(actionId, cell(COL.undoData), await trustedSheets());
        if ("error" in undoData) return { status: 409, error: `This can't be undone here: ${undoData.error}.` };
        const spec = undoData.spec;

        await applyUndo(sheets, spec, req.user!.email);
        await recordUndone(actionId, req.user!.email);
        const when = new Date().toISOString();
        // Find the row again: one inserted or a sort done by hand while the
        // undo ran would otherwise mark the wrong action (ROADMAP A8).
        const current = await findAction(sheets, spreadsheetId, actionId);
        if (current) await markUndone(sheets, spreadsheetId, current.rowIndex, `Undone by ${req.user!.email} at ${when}`);
        noteChange(ACTION_HISTORY_KEY);
        await logAction(req, {
          area: (cell(COL.area) || "Settings") as ActionArea,
          action: `Undo: ${cell(COL.action)}`,
          target: cell(COL.target),
          summary: `Undid "${cell(COL.summary)}" (by ${cell(COL.who)})`,
          before: cell(COL.after) || undefined,
          after: cell(COL.before) || undefined,
          location: cell(COL.location),
          undoOf: actionId,
        });
        // Everyone else's screen reloads the data (the change feed) and is
        // told why, so a bidder suddenly back to "waiting" isn't a mystery.
        announce(`${req.user!.email} undid an action: ${cell(COL.summary)}${cell(COL.who) ? ` (done by ${cell(COL.who)})` : ""}. It's back to how it was before.`, req.user!.email, cell(COL.area));
        return { status: 200 };
      });

      if (outcome.status !== 200) return res.status(outcome.status).json({ error: outcome.error });
      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof UndoRefusedError) return res.status(409).json({ error: error.message });
      next(error);
    }
  });

  return router;
}
