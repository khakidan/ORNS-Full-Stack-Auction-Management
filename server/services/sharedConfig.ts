import { getAdminFirestore } from "./firebaseAdmin";

/**
 * Server-side reads of the shared Config document (Firestore
 * `settings/global`) for settings the server must not take from the
 * browser.
 *
 * PayPal mode (ROADMAP.md M3): every route used to take `paypalIsSandbox`
 * from the request body while the sweeper read it from Firestore, so a
 * browser with a stale or tampered Config could create invoices in one
 * PayPal environment that the sweeper then looked for in the other. Now
 * every PayPal caller asks here, so they all agree.
 *
 * The value is cached for CACHE_TTL_MS so a busy checkout line isn't a
 * Firestore read per request. If a refresh fails, the last value read is
 * kept (with a warning); if there has never been a successful read, the
 * call throws rather than guessing - guessing wrong means real invoices
 * in the wrong environment.
 */
const CACHE_TTL_MS = 30 * 1000;

let cached: { isSandbox: boolean; readAt: number } | null = null;

export async function getPaypalIsSandbox(now = Date.now()): Promise<boolean> {
  if (cached && now - cached.readAt < CACHE_TTL_MS) return cached.isSandbox;
  try {
    const snap = await getAdminFirestore().collection("settings").doc("global").get();
    // Same default as the client's Config and the sweeper: anything but an
    // explicit `false` means sandbox, so a missing field never means live.
    const isSandbox = snap.data()?.paypalIsSandbox !== false;
    cached = { isSandbox, readAt: now };
    return isSandbox;
  } catch (err: any) {
    if (cached) {
      console.warn("[sharedConfig] Couldn't refresh PayPal mode from Firestore; using the last value read:", err?.message || err);
      return cached.isSandbox;
    }
    throw new Error(
      `Couldn't read the PayPal sandbox/live setting from Firestore (settings/global), so no PayPal request was made. ` +
      `Locally, run \`gcloud auth application-default login\`. Cause: ${err?.message || err}`
    );
  }
}

/** Test-only: forget the cached value. */
export function _resetSharedConfigForTesting(): void {
  cached = null;
}
