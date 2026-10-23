import { sheets_v4 } from "googleapis";
import { withLock } from "../utils/asyncLock";

export interface UpsertSettingParams {
  spreadsheetId: string;
  key: string;
  value: unknown;
  description?: string;
}

/**
 * Sets one `_Settings` row (column A key, B value, C description),
 * appending the row when the key isn't there yet. A blank description
 * keeps the row's existing one.
 *
 * Locked per spreadsheet (`settings:`), since it reads the whole tab to
 * find the key's row and then writes to it - a different lock from
 * `auction-items:`/`bidder-numbers:`, as it's a different sheet.
 */
export async function upsertSetting(sheets: sheets_v4.Sheets, params: UpsertSettingParams): Promise<void> {
  const { spreadsheetId, key, value, description } = params;
  await withLock(`settings:${spreadsheetId}`, async () => {
    const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: "_Settings!A:C" });
    const rows = result.data.values || [];
    const rowIndex = rows.findIndex((row) => row[0] === key) + 1;

    if (rowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `_Settings!B${rowIndex}:C${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[value, description || rows[rowIndex - 1][2] || ""]] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "_Settings!A:C",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[key, value, description || ""]] },
      });
    }
  });
}
