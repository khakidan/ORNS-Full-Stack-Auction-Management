/**
 * False for a blank, "undefined"/"null", or still-a-placeholder
 * ("PASTE_...") spreadsheet or folder ID - a setting nobody has filled in
 * yet, so there's nothing to read.
 */
export function isConfiguredId(id: string | null | undefined): id is string {
  return !!id && id !== "undefined" && id !== "null" && !id.includes("PASTE");
}
