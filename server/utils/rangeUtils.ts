/**
 * Normalizes a Google Sheets range string to ensure the sheet name is single-quoted.
 * This is crucial for sheet names containing special characters like hyphens (e.g. 'Auction-Items'!A:Z).
 */
export function normalizeRange(range: string): string {
  if (!range) return range;
  const exclIndex = range.indexOf('!');
  if (exclIndex === -1) {
    // If there is no exclamation mark but a sheet name is given, quote it if not already quoted
    if (!range.startsWith("'") && !range.startsWith('"')) {
      const escaped = range.replace(/'/g, "''");
      return `'${escaped}'`;
    }
    return range;
  }
  let sheetName = range.substring(0, exclIndex);
  const rangePart = range.substring(exclIndex + 1);
  if (!sheetName.startsWith("'") && !sheetName.startsWith('"')) {
    const escapedSheetName = sheetName.replace(/'/g, "''");
    sheetName = `'${escapedSheetName}'`;
  }
  return `${sheetName}!${rangePart}`;
}
