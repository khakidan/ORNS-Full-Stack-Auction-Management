import { sheets_v4 } from "googleapis";
import { AuctionItem } from "../../src/types";
import { parseItemRows } from "../../src/lib/itemParsing";

/**
 * Node-side port of
 * scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItemManager.gs's
 * `getValidSortedItems` (Code Hardening item #3) - purely for
 * architectural consistency with the rest of this app's GAS projects,
 * not a bug fix (see docs/agents/refactor-opportunities.md). Reuses
 * `src/lib/itemParsing.ts`'s existing header-aware row parsing rather
 * than re-encoding the Auction-Items schema a second time.
 */
export async function getValidSortedItems(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<AuctionItem[]> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:L" });
  const rows = res.data.values || [];
  if (rows.length === 0) return [];

  const items = parseItemRows(rows as string[][]);

  const validItems = items.filter((item) => {
    const status = (item.status || "").toLowerCase().trim();
    return status !== "inactive" && status !== "deleted";
  });

  validItems.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));

  return validItems;
}
