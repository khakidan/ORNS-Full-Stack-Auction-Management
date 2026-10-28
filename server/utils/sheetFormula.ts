/**
 * Neutralizes spreadsheet formula injection for a value about to be
 * written with valueInputOption: "USER_ENTERED" - for text typed by the
 * public (bug reports, ticket purchases), which Sheets would otherwise run
 * as a formula when it starts with =, +, -, or @ once a staff member opens
 * the sheet. Prefixing with a plain quote keeps Sheets treating the cell as
 * literal text while leaving the visible value unchanged.
 */
export function sanitizeForSheetFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
