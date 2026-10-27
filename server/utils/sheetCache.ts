import { noteChange } from "./changeFeed";
import crypto from "crypto";

// Shared server-side Google Sheets cache to handle write-to-read consistency
export const sheetCache = new Map<string, { data: any; timestamp: number }>();

export const CACHE_TTL = 5000; // 5 seconds cache

/**
 * Cache key for one user's read of one range. The user part is a hash of
 * their session's Google token, so a cached range is only ever served back
 * to the session that read it - never to someone signed in as a user who
 * can't open that spreadsheet (ROADMAP.md L5). Spreadsheet ID comes first
 * so clearCacheForSpreadsheet can still drop every user's entries for it.
 */
export function sheetCacheKey(
  spreadsheetId: string,
  tokens: { refresh_token?: string | null; access_token?: string | null } | undefined | null,
  range: string
): string {
  const credential = tokens?.refresh_token || tokens?.access_token || "";
  const user = crypto.createHash("sha256").update(credential).digest("hex").slice(0, 16);
  return `${spreadsheetId}:${user}:${range}`;
}

/**
 * Called after every write to a spreadsheet: drops its cached reads and
 * records the change for the browsers' live refresh (changeFeed.ts).
 */
export function clearCacheForSpreadsheet(spreadsheetId: string) {
  if (!spreadsheetId) return;
  noteChange(spreadsheetId);
  console.log(`[Cache Invalidation] Invalidating cached ranges for spreadsheet: ${spreadsheetId}`);
  for (const key of sheetCache.keys()) {
    if (key.startsWith(`${spreadsheetId}:`)) {
      sheetCache.delete(key);
    }
  }
}
