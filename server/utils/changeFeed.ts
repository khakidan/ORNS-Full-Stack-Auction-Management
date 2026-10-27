/**
 * A running count of changes, so every open browser can tell, cheaply and
 * without a Google call, that something it shows was changed by someone
 * else (or by an Undo) and quietly reload it.
 *
 * Every server write already calls clearCacheForSpreadsheet (sheetCache.ts),
 * which records the change here; actionLog.ts records "action-history".
 * Kept in process memory, like the locks and the sheet cache - correct
 * because the service runs as a single Cloud Run instance (README.md
 * "Required Cloud Run settings"). A restart starts the count again at 0;
 * browsers treat a count that went backwards as "reload everything".
 */
export const ACTION_HISTORY_KEY = "action-history";
/** The shared Config (settings/global) was saved - browsers re-read it. */
export const CONFIG_KEY = "config";

let version = 0;
const lastChanged = new Map<string, number>();

/** Something every open screen should be told about (an Undo), not just reload for. */
export interface Notice {
  version: number;
  message: string;
  /** Who caused it - their own screen already said so. */
  by: string;
}
const MAX_NOTICES = 50;
let notices: Notice[] = [];

/** Records that `key` (a spreadsheet ID, ACTION_HISTORY_KEY or CONFIG_KEY) changed. */
export function noteChange(key: string): void {
  if (!key) return;
  version += 1;
  lastChanged.set(key, version);
  if (lastChanged.size > 1000) {
    // Only ever a handful of spreadsheets; never let this grow without bound.
    const oldest = [...lastChanged.entries()].sort((a, b) => a[1] - b[1]).slice(0, 500);
    for (const [k] of oldest) lastChanged.delete(k);
  }
}

/** Records a message for every open screen (shown as a toast), e.g. "Dan undid ...". */
export function announce(message: string, by: string): void {
  version += 1;
  notices = [...notices, { version, message, by }].slice(-MAX_NOTICES);
}

/** The current count, and the keys changed and notices made after `since`. */
export function changesSince(since: number): { version: number; changed: string[]; notices: Notice[]; reset: boolean } {
  // A count that went backwards means the server restarted: report it so
  // the browser reloads everything rather than missing a change.
  if (since > version) return { version, changed: [], notices: [], reset: true };
  const changed = [...lastChanged.entries()].filter(([, v]) => v > since).map(([k]) => k);
  return { version, changed, notices: notices.filter((n) => n.version > since), reset: false };
}

/** Test-only. */
export function _resetChangeFeedForTesting(): void {
  version = 0;
  lastChanged.clear();
  notices = [];
}
