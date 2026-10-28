import { sheets_v4 } from "googleapis";
import { withLock } from "../utils/asyncLock";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";
import { ITEM_COL } from "../utils/sheetColumns";
import { UndoSpec } from "../utils/undoSpec";
import { deleteItem, updateItem } from "./itemService";
import { restoreBundle } from "./bundleService";
import { getRole, roleChangeRefusal, setRole } from "./userService";

/** Undo can't (or won't) reverse this action - the route answers 409 with the message. */
export class UndoRefusedError extends Error {}

const CHANGED_SINCE = "This has changed since, so undoing it would overwrite a later change. Fix it by hand instead.";

/** How a cell compares: "TRUE"/true, 150/"150" and "" / missing all match. */
function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function sameCells(current: unknown[][], expected: unknown[][]): boolean {
  const rows = Math.max(current.length, expected.length);
  for (let r = 0; r < rows; r++) {
    const cols = Math.max(current[r]?.length || 0, expected[r]?.length || 0);
    for (let c = 0; c < cols; c++) {
      if (norm(current[r]?.[c]) !== norm(expected[r]?.[c])) return false;
    }
  }
  return true;
}

/**
 * Undo writes USER_ENTERED (so "150" goes back as a number), which would
 * run a restored "=..." as a formula. Text starting with =, +, - or @ is
 * written as text instead ("'" prefix), unless it is just a number.
 */
function asText(v: unknown): unknown {
  if (typeof v !== "string" || !/^[=+\-@]/.test(v) || /^[+-]?(\d+\.?\d*|\.\d+)$/.test(v)) return v ?? "";
  return `'${v}`;
}

/** Fields of an item row that an item undo compares (ID is left out - renumbering changes it). */
function itemField(row: unknown[], field: string): unknown {
  const col = (ITEM_COL as Record<string, number>)[field];
  return col === undefined ? undefined : row[col];
}

/**
 * Reverses one recorded action. Every kind first checks that what the
 * action wrote is still there - if someone has changed it since, Undo
 * refuses (UndoRefusedError) rather than overwrite their change - and then
 * writes through the same code (and locks) the app's own actions use.
 */
export async function applyUndo(sheets: sheets_v4.Sheets, spec: UndoSpec, actorEmail: string): Promise<void> {
  switch (spec.kind) {
    case "cells": {
      const run = async () => {
        const current = await sheets.spreadsheets.values.get({ spreadsheetId: spec.spreadsheetId, range: spec.range, valueRenderOption: "UNFORMATTED_VALUE" });
        if (!sameCells(current.data.values || [], spec.after)) throw new UndoRefusedError(CHANGED_SINCE);
        await sheets.spreadsheets.values.update({
          spreadsheetId: spec.spreadsheetId,
          range: spec.range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: spec.before.map((row) => row.map(asText)) },
        });
        clearCacheForSpreadsheet(spec.spreadsheetId);
      };
      return spec.lock ? withLock(spec.lock, run) : run();
    }

    case "items": {
      for (const row of spec.rows) {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: spec.spreadsheetId, range: `'Auction-Items'!A${row.rowIndex}:M${row.rowIndex}`, valueRenderOption: "UNFORMATTED_VALUE" });
        const current = res.data.values?.[0] || [];
        const unchanged = Object.entries(row.after).every(([field, value]) => field === "id" || norm(itemField(current, field)) === norm(value));
        if (!unchanged) throw new UndoRefusedError(`Item "${row.name}": ${CHANGED_SINCE}`);
      }
      for (const row of spec.rows) {
        const { id: _id, ...changes } = row.before;
        const currentName = String(row.after.name ?? row.name);
        await updateItem(sheets, { spreadsheetId: spec.spreadsheetId, rowIndex: row.rowIndex, changes, expectedName: currentName });
      }
      return;
    }

    case "item-add": {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: spec.spreadsheetId, range: `'Auction-Items'!A${spec.rowIndex}:L${spec.rowIndex}` });
      const row = res.data.values?.[0] || [];
      if (norm(row[ITEM_COL.name]) !== norm(spec.name) || norm(row[ITEM_COL.status]) !== "active") {
        throw new UndoRefusedError(`Item "${spec.name}": ${CHANGED_SINCE}`);
      }
      await deleteItem(sheets, { spreadsheetId: spec.spreadsheetId, rowIndex: spec.rowIndex });
      return;
    }

    case "bundle": {
      try {
        await restoreBundle(sheets, { spreadsheetId: spec.spreadsheetId, targetBundleToken: spec.bundleToken });
      } catch (err: any) {
        throw new UndoRefusedError(`Couldn't restore the bundle "${spec.bundleName}": ${err?.message || err}`);
      }
      clearCacheForSpreadsheet(spec.spreadsheetId);
      return;
    }

    case "role": {
      const [actorRole, current] = await Promise.all([getRole(actorEmail), getRole(spec.email)]);
      const refusal = roleChangeRefusal(spec.email, spec.before, { email: actorEmail, role: actorRole }, current);
      if (refusal) throw new UndoRefusedError(refusal);
      if (current !== spec.after) throw new UndoRefusedError(`${spec.email}'s role: ${CHANGED_SINCE}`);
      await setRole(spec.email, spec.before, actorEmail);
      return;
    }
  }
}
