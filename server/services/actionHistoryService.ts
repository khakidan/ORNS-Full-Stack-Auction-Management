import { drive_v3, sheets_v4 } from "googleapis";
import { TrustedSheets } from "../utils/undoData";
import { ACTION_HISTORY_HEADER, ACTIONS_RANGE, ACTIONS_SHEET, COL, ActionRecord, parseActionRows } from "./actionHistoryRows";

/**
 * Creates the Action History spreadsheet in `folderId` (the Template Files folder): one
 * `Actions` tab with the header row frozen and bold, and a warning-only
 * protection so someone editing the log by hand is asked to confirm.
 * Returns its ID.
 */
export async function createActionHistorySpreadsheet(
  drive: drive_v3.Drive,
  sheets: sheets_v4.Sheets,
  folderId: string
): Promise<string> {
  const file = await drive.files.create({
    requestBody: { name: "Action History", mimeType: "application/vnd.google-apps.spreadsheet", parents: [folderId] },
    fields: "id",
    supportsAllDrives: true,
  });
  const spreadsheetId = file.data.id!;

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.sheetId" });
  const sheetId = meta.data.sheets?.[0]?.properties?.sheetId ?? 0;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId, title: ACTIONS_SHEET, gridProperties: { frozenRowCount: 1 } },
            fields: "title,gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
        {
          addProtectedRange: {
            protectedRange: {
              range: { sheetId },
              description: "Action History is written by the ORNS Auction Manager. Edit by hand only to fix a mistake.",
              warningOnly: true,
            },
          },
        },
      ],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${ACTIONS_SHEET}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[...ACTION_HISTORY_HEADER]] },
  });
  return spreadsheetId;
}

/** Every recorded action, newest first. `trusted`: where Sheet-edit rows may be undone (undoData.ts). */
export async function listActions(sheets: sheets_v4.Sheets, spreadsheetId: string, trusted: TrustedSheets): Promise<ActionRecord[]> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: ACTIONS_RANGE });
  return parseActionRows(res.data.values || [], trusted).reverse();
}

/**
 * One action's full row (including Undo Data), or null if no row has that
 * ID. `duplicated` is true when more than one row has it - a copied row,
 * which Undo refuses rather than guess which one is real.
 */
export async function findAction(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  actionId: string
): Promise<{ rowIndex: number; row: string[]; duplicated: boolean } | null> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: ACTIONS_RANGE });
  const values = (res.data.values || []) as string[][];
  const matches = values.flatMap((row, idx) => (idx > 0 && String(row[COL.id] ?? "") === actionId ? [idx] : []));
  if (!matches.length) return null;
  return { rowIndex: matches[0] + 1, row: values[matches[0]], duplicated: matches.length > 1 };
}

/** Fills an action's Undo column ("Undone by ... at ..."). */
export async function markUndone(sheets: sheets_v4.Sheets, spreadsheetId: string, rowIndex: number, text: string): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${ACTIONS_SHEET}'!M${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[text]] },
  });
}
