/**
 * Converts a zero-based column index to a spreadsheet column letter.
 * Example: 0 → "A", 25 → "Z", 26 → "AA"
 */
export function getColumnLetter(index: number): string {
  let letter = "";
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}
