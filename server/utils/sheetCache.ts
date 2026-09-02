// Shared server-side Google Sheets cache to handle write-to-read consistency
export const sheetCache = new Map<string, { data: any; timestamp: number }>();

export const CACHE_TTL = 5000; // 5 seconds cache

export function clearCacheForSpreadsheet(spreadsheetId: string) {
  if (!spreadsheetId) return;
  console.log(`[Cache Invalidation] Invalidating cached ranges for spreadsheet: ${spreadsheetId}`);
  for (const key of sheetCache.keys()) {
    if (key.startsWith(`${spreadsheetId}:`)) {
      sheetCache.delete(key);
    }
  }
}
