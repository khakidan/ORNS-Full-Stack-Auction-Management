import { sheets_v4 } from "googleapis";
import { withLock } from "../utils/asyncLock";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";
import { ensureSheetTab, FOLLOW_UP_HEADER } from "./sheetsService";

/**
 * The Dashboard's two special prizes: which Special-Winners cell holds
 * each winner's bidder number, and the item name a Follow-Up row records.
 */
export const SPECIAL_PRIZES = {
  giftCard: { cell: "B2", itemName: "$500 Amazon Gift Card" },
  raffle: { cell: "B3", itemName: "50/50 Raffle" },
} as const;
export type SpecialPrize = keyof typeof SPECIAL_PRIZES;

export interface SaveSpecialWinnerParams {
  spreadsheetId: string;
  prize: SpecialPrize;
  /** "" clears the winner. */
  bidderId: string;
  /** The winner already checked out, so the prize goes on the Follow-Up sheet too. */
  addFollowUp: boolean;
}

/**
 * Saves the gift-card or raffle winner, and adds a Follow-Up row when the
 * winner has already checked out.
 *
 * Holds the `bidder-numbers:` lock because recordWinningBid (which holds
 * it too) also creates and appends to the Follow-Up tab - two creators at
 * once would make Sheets refuse the second "add sheet".
 */
/** `range` is the winner cell and `before` the bidder number it held, for Action History. */
export async function saveSpecialWinner(sheets: sheets_v4.Sheets, params: SaveSpecialWinnerParams): Promise<{ success: boolean; range: string; before: string }> {
  const { spreadsheetId, prize, bidderId, addFollowUp } = params;
  return withLock(`bidder-numbers:${spreadsheetId}`, async () => {
    await ensureSheetTab(sheets, spreadsheetId, "Special-Winners");
    const range = `'Special-Winners'!${SPECIAL_PRIZES[prize].cell}`;
    const old = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const before = String(old.data.values?.[0]?.[0] ?? "");
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[bidderId]] },
    });

    if (addFollowUp && bidderId) {
      await ensureSheetTab(sheets, spreadsheetId, "Follow-Up", FOLLOW_UP_HEADER);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "'Follow-Up'!A:C",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[bidderId, SPECIAL_PRIZES[prize].itemName, ""]] },
      });
    }

    clearCacheForSpreadsheet(spreadsheetId);
    return { success: true, range, before };
  });
}
