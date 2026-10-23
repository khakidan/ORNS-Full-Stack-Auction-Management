import { sheets_v4 } from "googleapis";
import { withLock } from "../utils/asyncLock";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";

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
 * Creates a tab when the spreadsheet doesn't have it yet. Special-Winners
 * isn't built by the sheet sync, so the first save makes it; a new
 * Follow-Up tab gets the same header recordWinningBid writes.
 */
async function ensureSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, title: string): Promise<void> {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  if (metadata.data.sheets?.some((s) => s.properties?.title === title)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  if (title === "Follow-Up") {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "'Follow-Up'!A1:C1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Bidder ID", "Item ID", "Amount"]] },
    });
  }
}

/**
 * Saves the gift-card or raffle winner, and adds a Follow-Up row when the
 * winner has already checked out.
 *
 * Holds the `bidder-numbers:` lock because recordWinningBid (which holds
 * it too) also creates and appends to the Follow-Up tab - two creators at
 * once would make Sheets refuse the second "add sheet".
 */
export async function saveSpecialWinner(sheets: sheets_v4.Sheets, params: SaveSpecialWinnerParams): Promise<{ success: boolean }> {
  const { spreadsheetId, prize, bidderId, addFollowUp } = params;
  return withLock(`bidder-numbers:${spreadsheetId}`, async () => {
    await ensureSheet(sheets, spreadsheetId, "Special-Winners");
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Special-Winners'!${SPECIAL_PRIZES[prize].cell}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[bidderId]] },
    });

    if (addFollowUp && bidderId) {
      await ensureSheet(sheets, spreadsheetId, "Follow-Up");
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "'Follow-Up'!A:C",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[bidderId, SPECIAL_PRIZES[prize].itemName, ""]] },
      });
    }

    clearCacheForSpreadsheet(spreadsheetId);
    return { success: true };
  });
}
