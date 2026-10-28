import { Request } from "express";
import { sheets_v4 } from "googleapis";
import { sheetsFor } from "../utils/googleClients";
import { ROLE_LABELS } from "../utils/permissions";
import { UndoSpec } from "../utils/undoSpec";
import { getActionHistorySpreadsheetId } from "./actionHistoryStore";
import { ACTIONS_RANGE, buildActionRow, ActionRowInput } from "./actionHistoryRows";
import { ACTION_HISTORY_KEY, noteChange } from "../utils/changeFeed";

/** How long a request waits for its log row before answering anyway. */
const LOG_TIMEOUT_MS = 5000;

export type ActionArea = "Bid Management" | "Auction Items" | "Tickets" | "Settings" | "Users";

export interface ActionEntry {
  area: ActionArea;
  action: string;
  target?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  /** Spreadsheet and range written, for people reading the log. */
  location?: string;
  /** How to reverse it. Leave out for actions Undo can't reverse... */
  undo?: UndoSpec;
  /** ...and say why, for the Undo column. */
  notUndoableReason?: string;
  /** On an Undo row: the Action ID it reversed. */
  undoOf?: string;
}

/**
 * Records one action in the Action History spreadsheet, as the person
 * acting (their own Google access), with who they are and their role.
 *
 * Awaited before the route answers (Cloud Run throttles CPU once the
 * response is sent) but capped at LOG_TIMEOUT_MS. It never throws: if the
 * spreadsheet isn't set up yet or the write fails, the row goes to Cloud
 * Logging instead (search `jsonPayload.actionLog`), so the action itself
 * is never blocked or lost from the record.
 */
export async function logAction(req: Request, entry: ActionEntry): Promise<void> {
  await appendActionRow(sheetsFor(req), {
    who: req.user?.email || "unknown",
    role: req.user ? ROLE_LABELS[req.user.role] : "",
    source: "App",
    ...entry,
  });
}

/**
 * logAction for work the server does on its own, with no request - the
 * PayPal sweeper (ROADMAP B5). Written with `sheets` (the job's own Google
 * access); `who` names the job.
 */
export async function logSystemAction(sheets: sheets_v4.Sheets, who: string, entry: ActionEntry): Promise<void> {
  await appendActionRow(sheets, { who, role: "System", source: "App", ...entry });
}

async function appendActionRow(sheets: sheets_v4.Sheets, input: ActionRowInput): Promise<void> {
  const row = buildActionRow(input);
  try {
    const spreadsheetId = await getActionHistorySpreadsheetId();
    if (!spreadsheetId) {
      writeToCloudLogging("Action History spreadsheet isn't set up yet", row);
      return;
    }
    await Promise.race([
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: ACTIONS_RANGE,
        // RAW: names and descriptions are typed by people and must never
        // be read as formulas.
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] },
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${LOG_TIMEOUT_MS}ms`)), LOG_TIMEOUT_MS)),
    ]);
    noteChange(ACTION_HISTORY_KEY);
  } catch (err: any) {
    writeToCloudLogging(`Couldn't write to the Action History spreadsheet: ${err?.message || err}`, row);
  }
}

function writeToCloudLogging(reason: string, row: string[]): void {
  console.log(JSON.stringify({ severity: "NOTICE", message: `[ActionLog] ${reason}`, actionLog: row }));
}
