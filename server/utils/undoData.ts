import crypto from "crypto";
import { ROLE_LABELS, isRole } from "./permissions";
import { UndoSpec } from "./undoSpec";

/**
 * The Action History spreadsheet is shared with every staff member, so its
 * Undo Data column can be typed into by anyone on staff - and Undo runs
 * with a Full Administrator's access. So Undo only acts on Undo Data it can
 * trust (ROADMAP A1):
 *
 * - Rows the app writes are signed: `v1:<HMAC>:<JSON>`, the HMAC over the
 *   Action ID and the JSON with a key derived from SESSION_SECRET (never in
 *   the spreadsheet). A row whose JSON or ID was changed by hand fails the
 *   check. Changing SESSION_SECRET makes earlier rows un-undoable.
 * - Rows the Items/Tickets Apps Scripts write (Sheet edits) can't be signed
 *   (the scripts have no secret). Their plain JSON is accepted only as one
 *   cell of the configured Items or Tickets spreadsheet - which the person
 *   who could forge it can already edit directly - and only its values are
 *   taken from the row; the lock is worked out here.
 */
const SIGNED = /^v1:([0-9a-f]{64}):([\s\S]*)$/;

function signingKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to sign Undo Data.");
  return crypto.createHmac("sha256", secret).update("orns-action-history-undo-data").digest();
}

function mac(actionId: string, json: string): string {
  return crypto.createHmac("sha256", signingKey()).update(`${actionId}\n${json}`).digest("hex");
}

/** The Undo Data cell for an app-written row. */
export function signUndoData(actionId: string, json: string): string {
  return `v1:${mac(actionId, json)}:${json}`;
}

/** The Items and Tickets spreadsheets (Config) - the only places a Sheet-edit row may be undone. */
export interface TrustedSheets {
  itemsSpreadsheetId: string;
  ticketsSpreadsheetId: string;
}

export type UndoDataResult = { spec: UndoSpec } | { error: string };

const TAMPERED = "its Undo Data was changed in the spreadsheet by hand";
const NOT_FROM_APP = "its Undo Data wasn't written by the app";

/** One quoted tab and one cell, as the Apps Scripts write it: `'tab'!F57`. */
const SINGLE_CELL = /^'[^!]*'![A-Z]{1,3}[1-9][0-9]*$/;

const isCellValue = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const oneCell = (v: unknown): v is [[unknown]] =>
  Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1 && isCellValue(v[0][0]);

/** Checks an Undo Data cell; `error` says why Undo can't use it (after "Can't be undone: "). */
export function readUndoData(actionId: string, cell: string, trusted: TrustedSheets): UndoDataResult {
  const signed = SIGNED.exec(cell);
  if (signed) {
    const expected = Buffer.from(mac(actionId, signed[2]), "hex");
    if (!crypto.timingSafeEqual(expected, Buffer.from(signed[1], "hex"))) return { error: TAMPERED };
    try {
      return { spec: JSON.parse(signed[2]) };
    } catch {
      return { error: "its Undo Data is unreadable" };
    }
  }

  let data: any;
  try {
    data = JSON.parse(cell);
  } catch {
    return { error: NOT_FROM_APP };
  }
  const { itemsSpreadsheetId, ticketsSpreadsheetId } = trusted;
  const id = typeof data?.spreadsheetId === "string" ? data.spreadsheetId : "";
  const sheetEdit =
    data?.kind === "cells" &&
    !!id && (id === itemsSpreadsheetId || id === ticketsSpreadsheetId) &&
    typeof data.range === "string" && SINGLE_CELL.test(data.range) &&
    oneCell(data.before) && oneCell(data.after);
  if (!sheetEdit) return { error: NOT_FROM_APP };
  return {
    spec: {
      kind: "cells",
      spreadsheetId: id,
      range: data.range,
      before: [[data.before[0][0]]],
      after: [[data.after[0][0]]],
      ...(id === itemsSpreadsheetId ? { lock: `auction-items:${id}` } : {}),
    },
  };
}

const show = (v: unknown) => JSON.stringify(v ?? "");

/** What Undo will write, in words, for the confirmation dialog. */
export function describeUndo(spec: UndoSpec): string {
  switch (spec.kind) {
    case "cells": {
      const values = spec.before.map((row) => row.map(show).join(", ")).join("; ");
      return `Writes ${values} to ${spec.range} in spreadsheet ${spec.spreadsheetId}.`;
    }
    case "items":
      return spec.rows
        .map((r) => `Item "${r.name}" (row ${r.rowIndex}): ${Object.entries(r.before).filter(([f]) => f !== "id").map(([f, v]) => `${f} ${show(v)}`).join(", ")}.`)
        .join(" ");
    case "item-add":
      return `Deletes the item "${spec.name}" (row ${spec.rowIndex}).`;
    case "bundle":
      return `Splits the bundle "${spec.bundleName}" back into its items.`;
    case "role":
      return `Sets ${spec.email}'s role back to ${isRole(spec.before) ? ROLE_LABELS[spec.before] : show(spec.before)}.`;
    default:
      return "Unknown kind of undo.";
  }
}
