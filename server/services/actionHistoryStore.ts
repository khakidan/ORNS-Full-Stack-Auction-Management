import { getAdminFirestore } from "./firebaseAdmin";

/**
 * Where the Action History spreadsheet is: Firestore `system/actionHistory`
 * `{ spreadsheetId, createdBy, createdAt }`, server-only like the other
 * `system/*` docs. Kept out of the shared Config (`settings/global`) so
 * adding it didn't change firestore.rules' strict Config shape.
 *
 * Read on every logged action, so cached like sharedConfig.ts. "" means
 * it hasn't been created yet (or Firestore can't be read and nothing is
 * cached) - actions are then written to Cloud Logging instead.
 */
const DOC = () => getAdminFirestore().collection("system").doc("actionHistory");
const CACHE_TTL_MS = 30 * 1000;
let cached: { id: string; readAt: number } | null = null;

export async function getActionHistorySpreadsheetId(now = Date.now()): Promise<string> {
  if (cached && now - cached.readAt < CACHE_TTL_MS) return cached.id;
  try {
    const id = String((await DOC().get()).data()?.spreadsheetId || "").trim();
    cached = { id, readAt: now };
    return id;
  } catch (err: any) {
    console.warn("[ActionHistory] Couldn't read the spreadsheet ID from Firestore:", err?.message || err);
    return cached?.id ?? "";
  }
}

export async function setActionHistorySpreadsheetId(spreadsheetId: string, createdBy: string): Promise<void> {
  await DOC().set({ spreadsheetId, createdBy, createdAt: new Date().toISOString() });
  cached = { id: spreadsheetId, readAt: Date.now() };
}

/** Test-only. */
export function _resetActionHistoryStoreForTesting(): void {
  cached = null;
}
