import crypto from "crypto";
import { UndoSpec } from "../utils/undoSpec";
import { describeUndo, readUndoData, signUndoData, TrustedSheets } from "../utils/undoData";

/** The `Actions` tab's columns (schema.md). The Apps Scripts write the same columns - keep them in step. */
export const ACTION_HISTORY_HEADER = [
  "Action ID", "Timestamp", "Who", "Role", "Source", "Area", "Action", "Target",
  "Summary", "Before", "After", "Location", "Undo", "Undo of", "Undo Data",
] as const;

export const ACTIONS_SHEET = "Actions";
export const ACTIONS_RANGE = `'${ACTIONS_SHEET}'!A:O`;
export const COL = { id: 0, timestamp: 1, who: 2, role: 3, source: 4, area: 5, action: 6, target: 7, summary: 8, before: 9, after: 10, location: 11, undo: 12, undoOf: 13, undoData: 14 } as const;

/** A Sheets cell holds at most 50,000 characters. */
const MAX_CELL = 45000;

export interface ActionRowInput {
  who: string;
  role: string;
  source: "App" | "Sheet edit";
  area: string;
  action: string;
  target?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  location?: string;
  undo?: UndoSpec;
  notUndoableReason?: string;
  undoOf?: string;
}

export function newActionId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

function json(value: unknown): string {
  if (value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}...(cut)` : text;
}

export function buildActionRow(input: ActionRowInput, now = new Date()): string[] {
  const id = newActionId(now);
  const undoStatus = input.undo ? "" : `Can't be undone: ${input.notUndoableReason || "this action can't be reversed in the app"}`;
  return [
    id,
    now.toISOString(),
    input.who,
    input.role,
    input.source,
    input.area,
    input.action,
    input.target || "",
    input.summary,
    json(input.before),
    json(input.after),
    input.location || "",
    input.undoOf ? "" : undoStatus,
    input.undoOf || "",
    // Signed so Undo can tell it from Undo Data typed into the sheet (undoData.ts).
    input.undo ? signUndoData(id, json(input.undo)) : "",
  ];
}

export interface ActionRecord {
  rowIndex: number;
  id: string;
  timestamp: string;
  who: string;
  role: string;
  source: string;
  area: string;
  action: string;
  target: string;
  summary: string;
  before: string;
  after: string;
  location: string;
  undo: string;
  undoOf: string;
  /** True when Undo can be offered: has Undo Data Undo can trust, and hasn't been undone or refused. */
  undoable: boolean;
  /** What Undo will write (from the Undo Data), for the confirmation; "" when not undoable. */
  undoPreview: string;
}

export function parseActionRows(values: unknown[][], trusted: TrustedSheets): ActionRecord[] {
  return values.slice(1).map((row, i) => {
    const cell = (c: number) => String(row?.[c] ?? "");
    const pending = !!cell(COL.undoData) && !cell(COL.undo);
    const undoData = pending ? readUndoData(cell(COL.id), cell(COL.undoData), trusted) : null;
    const untrusted = undoData && "error" in undoData ? `Can't be undone: ${undoData.error}` : "";
    return {
      rowIndex: i + 2,
      id: cell(COL.id),
      timestamp: cell(COL.timestamp),
      who: cell(COL.who),
      role: cell(COL.role),
      source: cell(COL.source),
      area: cell(COL.area),
      action: cell(COL.action),
      target: cell(COL.target),
      summary: cell(COL.summary),
      before: cell(COL.before),
      after: cell(COL.after),
      location: cell(COL.location),
      undo: cell(COL.undo) || untrusted,
      undoOf: cell(COL.undoOf),
      undoable: !!undoData && "spec" in undoData,
      undoPreview: undoData && "spec" in undoData ? describeUndo(undoData.spec) : "",
    };
  }).filter((r) => r.id);
}
