import crypto from "crypto";
import { getAdminFirestore } from "./firebaseAdmin";

/**
 * Durable idempotency records in Firestore (`idempotency/<hash>`), for
 * routes whose requests can arrive long after they were made - a winning
 * bid saved on a device while the Wi-Fi was down and resent later
 * (ROADMAP.md Milestone A).
 *
 * The in-memory map in utils/idempotency.ts forgets every key when Cloud
 * Run restarts or scales to zero (min instances is 0), so a resend after
 * an idle spell would run the action again. These records last
 * DURABLE_TTL_MS. `expireAt` is a real timestamp so a Firestore TTL policy
 * on that field can delete old records (README "Deployment"); without
 * the policy they're just small documents that never get read again.
 *
 * Both calls are best-effort: if Firestore can't be reached, the caller
 * falls back to the in-memory map alone, rather than failing the request.
 */
export const DURABLE_TTL_MS = 24 * 60 * 60 * 1000;

const COLLECTION = "idempotency";

/** Firestore document ids can't contain "/", and keys come from request bodies - so the id is a hash. */
function docId(fullKey: string): string {
  return crypto.createHash("sha256").update(fullKey).digest("hex");
}

/** The stored result for this key, or undefined if there isn't one (or it has expired). */
export async function getStoredResult(fullKey: string, now = Date.now()): Promise<{ result: unknown } | undefined> {
  const snap = await getAdminFirestore().collection(COLLECTION).doc(docId(fullKey)).get();
  if (!snap.exists) return undefined;
  const data = snap.data() || {};
  const expireAt = data.expireAt?.toMillis ? data.expireAt.toMillis() : new Date(data.expireAt).getTime();
  // TTL deletion can lag by a day, so expiry is checked here too.
  if (!expireAt || expireAt <= now) return undefined;
  return { result: JSON.parse(String(data.result)) };
}

export async function storeResult(fullKey: string, result: unknown, now = Date.now()): Promise<void> {
  await getAdminFirestore().collection(COLLECTION).doc(docId(fullKey)).set({
    key: fullKey,
    // Stored as a JSON string so any result shape round-trips unchanged.
    result: JSON.stringify(result ?? null),
    createdAt: new Date(now),
    expireAt: new Date(now + DURABLE_TTL_MS),
  });
}
