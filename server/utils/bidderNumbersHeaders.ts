import { sheets_v4 } from "googleapis";

/**
 * Header row for the Bid-Management spreadsheet's Bidder-Numbers tab.
 * A-K are written when the tab is built (syncService.ts); L-N are
 * tracking columns the app fills in later:
 *   L - when checkout put a credit-card payment into "PayPal Verification
 *       Pending" (read and cleared by the PayPal sweeper)
 *   M - when this bidder's receipt was last emailed
 *   N - the invoice link that email carried (Email All skips a bidder
 *       whose N matches their current invoice)
 * See docs/agents/schema.md.
 */
export const BIDDER_NUMBERS_HEADERS = [
  "ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid", "Payment Method", "Invoice URL", "Invoiced Amount",
  "PayPal Pending Since", "Receipt Emailed At", "Receipt Emailed Invoice",
];

const TRACKING_HEADERS = BIDDER_NUMBERS_HEADERS.slice(11); // L, M, N

/**
 * Labels Bidder-Numbers L1:N1 if any of them is blank - for tabs built
 * before those columns existed. Called by every path that writes L, M, or
 * N. Never overwrites a header someone has already typed in.
 */
export async function ensureTrackingHeaders(sheets: sheets_v4.Sheets, spreadsheetId: string, sheetName = "Bidder-Numbers"): Promise<void> {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!L1:N1` });
  const current = res.data.values?.[0] || [];
  if (TRACKING_HEADERS.every((_, i) => String(current[i] ?? "").trim() !== "")) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!L1:N1`,
    valueInputOption: "RAW",
    requestBody: { values: [TRACKING_HEADERS.map((header, i) => String(current[i] ?? "").trim() || header)] },
  });
}
