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
  // Merged, so a record of who turned edit tracking on (same doc) survives.
  await DOC().set({ spreadsheetId, createdBy, createdAt: new Date().toISOString() }, { merge: true });
  cached = { id: spreadsheetId, readAt: Date.now() };
}

/**
 * Who last turned edit tracking on, and when (`editTracking` on the same
 * doc; null once turned off). The on-edit triggers run as the admin who
 * installed them, so if that account goes, recording silently stops while
 * the script still says "on" - showing whose trigger it is lets an admin
 * spot that and turn it on again as themselves (ROADMAP A11).
 */
export interface EditTrackingRecord {
  by: string;
  at: string;
}

export async function getEditTrackingRecord(): Promise<EditTrackingRecord | null> {
  const record = (await DOC().get()).data()?.editTracking;
  return record && typeof record.by === "string" ? { by: record.by, at: String(record.at || "") } : null;
}

export async function setEditTrackingRecord(record: EditTrackingRecord | null): Promise<void> {
  await DOC().set({ editTracking: record }, { merge: true });
}

/**
 * Actions already undone: Firestore `undoneActions/{actionId}`
 * `{ undoneBy, undoneAt }`. The "Undone by" text in the spreadsheet can be
 * cleared by anyone on staff, so this is what stops one action being
 * undone twice (a replay - ROADMAP A1).
 */
const UNDONE = (actionId: string) => getAdminFirestore().collection("undoneActions").doc(encodeURIComponent(actionId));

export async function wasUndone(actionId: string): Promise<boolean> {
  return (await UNDONE(actionId).get()).exists;
}

export async function recordUndone(actionId: string, undoneBy: string): Promise<void> {
  await UNDONE(actionId).set({ undoneBy, undoneAt: new Date().toISOString() });
}

/** Test-only. */
export function _resetActionHistoryStoreForTesting(): void {
  cached = null;
}
