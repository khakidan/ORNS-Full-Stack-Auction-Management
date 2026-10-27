import { getSharedConfig, _resetConfigCacheForTesting } from "./configService";

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
 * Read through configService.ts's cached Config (30 seconds, replaced at
 * once by a save), so a busy checkout line isn't a Firestore read per
 * request. If a refresh fails, the last value read is kept (with a
 * warning); if there has never been a successful read, the call throws
 * rather than guessing - guessing wrong means real invoices in the wrong
 * environment.
 */
export async function getPaypalIsSandbox(now = Date.now()): Promise<boolean> {
  try {
    return (await getSharedConfig(now)).paypalIsSandbox;
  } catch (err: any) {
    throw new Error(
      `Couldn't read the PayPal sandbox/live setting from Firestore (settings/global), so no PayPal request was made. ` +
      `Locally, run \`gcloud auth application-default login\`. Cause: ${err?.message || err}`
    );
  }
}

/** Test-only: forget the cached value. */
export function _resetSharedConfigForTesting(): void {
  _resetConfigCacheForTesting();
}
