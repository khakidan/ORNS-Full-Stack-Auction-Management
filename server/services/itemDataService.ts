import { sheets_v4 } from "googleapis";
import { AuctionItem } from "../../src/types";
import { parseItemRows } from "../../src/lib/itemParsing";

/**
 * Node-side port of
 * scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItemManager.gs's
 * `getValidSortedItems` (Code Hardening item #3) - purely for
 * architectural consistency with the rest of this app's GAS projects,
 * not a bug fix (see docs/agents/CHANGELOG.md). Reuses
 * `src/lib/itemParsing.ts`'s existing header-aware row parsing rather
 * than re-encoding the Auction-Items schema a second time.
 */
export async function getValidSortedItems(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<AuctionItem[]> {
  // UNFORMATTED_VALUE is required here, not the API's FORMATTED_VALUE
  // default: staff enter Value/Opening Bid/Min Raise as currency text
  // (e.g. "$100.00") via USER_ENTERED writes elsewhere (itemService.ts),
  // which Sheets auto-converts into a real number with currency
  // formatting applied. GAS's native SpreadsheetApp.getValues() always
  // returned that number RAW (no "$", no thousands separator) - which is
  // exactly what every Doc generator's own hardcoded "$" prefix
  // (Class_BidSheetDoc.gs's valueLabel, Class_CatalogDoc.gs's
  // `Value: $${item.value}`, etc.) assumes. Without this override, Node
  // gets the pre-formatted display string instead ("$1,000.00"),
  // producing a doubled "$" and mismatched formatting on every generated
  // document. See docs/agents/CHANGELOG.md.
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Auction-Items'!A:L",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
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
