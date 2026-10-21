import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getOAuthClient } from "./oauth";
import { getAdminFirestore } from "./firebaseAdmin";
import { PayPalService } from "./paypalService";
import { withLock } from "../utils/asyncLock";

/**
 * Node-side port of
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/PayPalSweeper.gs's
 * `checkPendingPayPalInvoices` (Code Hardening item #2, Step 4) - a
 * standing background service, not "data Node fetches on request" like
 * Steps 1-3, so it needs its own credential and its own scheduling
 * (see startPaypalSweeperSchedule below) rather than piggybacking on an
 * HTTP request's session tokens.
 *
 * Authenticates via a refresh token persisted the last time any staff
 * member logged into the app (see authRoutes.ts's `/auth/callback` ->
 * `persistSweeperCredential`), stored server-side in Firestore
 * (`system/paypalSweeperAuth`, admin-only - not covered by
 * firestore.rules, never client-writable) since this job has no request
 * of its own to draw session tokens from. See
 * docs/agents/refactor-opportunities.md's Code Hardening item #2, Step 4
 * / CHANGELOG.md.
 */

const SWEEPER_CREDENTIAL_COLLECTION = "system";
const SWEEPER_CREDENTIAL_DOC = "paypalSweeperAuth";
const SWEEPER_STATUS_DOC = "paypalSweeperStatus";
const TEN_MINUTES_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MINUTES = 5;
const PAYPAL_PENDING_LABEL = "PayPal Verification Pending";

export async function persistSweeperCredential(refreshToken: string, updatedBy: string): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(SWEEPER_CREDENTIAL_COLLECTION).doc(SWEEPER_CREDENTIAL_DOC).set({
    refreshToken,
    updatedBy,
    updatedAt: new Date().toISOString(),
  });
}

async function getSweeperAuthClient(): Promise<OAuth2Client | null> {
  try {
    const db = getAdminFirestore();
    const snap = await db.collection(SWEEPER_CREDENTIAL_COLLECTION).doc(SWEEPER_CREDENTIAL_DOC).get();
    const refreshToken = snap.data()?.refreshToken;
    if (!refreshToken) return null;

    const client = getOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  } catch (err: any) {
    console.warn("[Sweeper] Unable to access background-sync credentials in Firestore:", err?.message || err);
    return null;
  }
}

export interface PaypalSweepResult {
  pending: number;
  resolved: number;
  escalated: number;
}

export type PaypalSweepOutcome = PaypalSweepResult | { skipped: string };

/**
 * In-process cache of the sweeper's last run, for the Configuration page's
 * status card (Code Hardening item #2's two manual-only steps - "an admin
 * must sign in once" and "confirm the Node job is running reliably" - were
 * otherwise unverifiable from inside the app itself; see
 * docs/agents/refactor-opportunities.md). Also mirrored to Firestore
 * (`system/paypalSweeperStatus`, written by `runPaypalSweep` below) so the
 * status card survives a Cloud Run redeploy instead of reporting "Never"
 * on every new revision even though the sweep has genuinely run before -
 * `getSweeperStatus` prefers this in-memory copy (cheap, no round trip)
 * and falls back to the Firestore copy when the process is fresh.
 */
let lastRun: { at: string; outcome: PaypalSweepOutcome } | null = null;
let scheduleStartedAt: number | null = null;
let configuredIntervalMinutes = DEFAULT_INTERVAL_MINUTES;

export interface SweeperStatus {
  credentialConfigured: boolean;
  credentialUpdatedBy: string | null;
  credentialUpdatedAt: string | null;
  intervalMinutes: number;
  scheduleRunning: boolean;
  lastRunAt: string | null;
  lastResult: PaypalSweepOutcome | null;
  nextRunAt: string | null;
}

/**
 * Reads both halves of "is the background sweep actually working": the
 * stored credential (`persistSweeperCredential` only ever runs on a real
 * login) and this process's own record of its last run. `nextRunAt` is a
 * best-effort estimate (last run time, or schedule start if it hasn't run
 * yet, plus one interval) - accurate for a steady `setInterval`, but not a
 * guarantee, since a slow sweep or a process restart can shift it.
 */
export async function getSweeperStatus(): Promise<SweeperStatus> {
  let data: any = null;
  let persistedRun: { at: string; outcome: PaypalSweepOutcome } | null = null;
  try {
    const db = getAdminFirestore();
    const [credentialSnap, statusSnap] = await Promise.all([
      db.collection(SWEEPER_CREDENTIAL_COLLECTION).doc(SWEEPER_CREDENTIAL_DOC).get(),
      db.collection(SWEEPER_CREDENTIAL_COLLECTION).doc(SWEEPER_STATUS_DOC).get(),
    ]);
    data = credentialSnap.data();
    const statusData = statusSnap.data();
    if (statusData?.at && statusData?.outcome) {
      persistedRun = { at: statusData.at, outcome: statusData.outcome };
    }
  } catch (err: any) {
    console.warn("[Sweeper] getSweeperStatus failed to query Firestore:", err?.message || err);
  }

  const effectiveRun = lastRun ?? persistedRun;
  const intervalMs = configuredIntervalMinutes * 60 * 1000;
  const anchor = effectiveRun ? new Date(effectiveRun.at).getTime() : scheduleStartedAt;
  const nextRunAt = anchor !== null ? new Date(anchor + intervalMs).toISOString() : null;

  return {
    credentialConfigured: !!data?.refreshToken,
    credentialUpdatedBy: data?.updatedBy ?? null,
    credentialUpdatedAt: data?.updatedAt ?? null,
    intervalMinutes: configuredIntervalMinutes,
    scheduleRunning: scheduleStartedAt !== null,
    lastRunAt: effectiveRun?.at ?? null,
    lastResult: effectiveRun?.outcome ?? null,
    nextRunAt,
  };
}

/**
 * Escalation destination for stuck PayPal verifications - deliberately
 * NOT the client-facing "Follow-Up" sheet (Dashboard's Post-Checkout Item
 * Wins panel / recordWinningBidLocked in auctionService.ts), which owns a
 * different, incompatible 3-column schema (`["Bidder ID","Item ID",
 * "Amount"]`). The two used to collide on the same sheet name with
 * different headers - whichever wrote first "won" the header, and the
 * other's appends landed under the wrong columns. Found in a hardening
 * audit - see docs/agents/refactor-opportunities.md's Code Hardening item
 * #1 / CHANGELOG.md.
 */
const PAYPAL_FOLLOW_UP_SHEET = "PayPal-Follow-Up";

async function ensureFollowUpSheet(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string): Promise<void> {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = metadata.data.sheets?.some((s) => s.properties?.title === PAYPAL_FOLLOW_UP_SHEET);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: PAYPAL_FOLLOW_UP_SHEET } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${PAYPAL_FOLLOW_UP_SHEET}!A1:F1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Timestamp", "Bidder Number", "Name", "Amount Flagged", "Invoice URL", "System Notes"]] },
  });
}

/**
 * Scans `Bidder-Numbers` for the `"PayPal Verification Pending"` marker
 * (Code Hardening item #2, Step 3's deferred credit-card path) and either
 * resolves it (PayPal now shows the invoice paid) or escalates it to
 * `PayPal-Follow-Up` once it's been pending longer than 10 minutes - mirrors
 * `PayPalSweeper.gs`'s `checkPendingPayPalInvoices` exactly, evaluating
 * rows bottom-up. One row's failure is logged and skipped rather than
 * aborting the whole sweep.
 *
 * The public entry point wraps this in `runPaypalSweep` below, which
 * records the outcome into `lastRun` for `getSweeperStatus` - every real
 * return path (skipped, or the pending/resolved/escalated tally) funnels
 * through that one wrapper regardless of which early-return branch fires.
 */
async function runPaypalSweepInner(): Promise<PaypalSweepOutcome> {
  const client = await getSweeperAuthClient();
  if (!client) {
    return { skipped: "No background-sync credential stored yet - have an admin sign in once to enable the sweeper." };
  }

  const db = getAdminFirestore();
  const configSnap = await db.collection("settings").doc("global").get();
  const config = configSnap.data() || {};
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const bidderNumbersSheet = config.bidderNumbersSheet || "Bidder-Numbers";

  if (!spreadsheetId) {
    return { skipped: "No bidManagementSpreadsheetId configured yet." };
  }

  const paypal = new PayPalService({ isSandbox: config.paypalIsSandbox !== false });
  const sheets = google.sheets({ version: "v4", auth: client });

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${bidderNumbersSheet}'!A:L` });
  const rows = res.data.values || [];
  const now = Date.now();

  let pending = 0;
  let resolved = 0;
  let escalated = 0;

  for (let i = rows.length - 1; i >= 1; i--) {
    const snapshotRow = rows[i];
    if (snapshotRow[8] !== PAYPAL_PENDING_LABEL) continue;
    pending++;

    const rowNumber = i + 1;
    const bidderId = snapshotRow[0];
    const lastName = snapshotRow[2];
    const invoiceUrlCell = snapshotRow[9];

    try {
      const invoiceId = paypal.extractInvoiceIdFromUrl(invoiceUrlCell);
      if (!invoiceId) {
        console.warn(`[PayPalSweeper] Row ${rowNumber}: pending but no evaluable Invoice ID.`);
        continue;
      }

      // The PayPal lookup happens outside the lock, so a slow PayPal
      // response never holds up checkout or bid recording.
      const liveStatus = await paypal.getInvoiceStatus(invoiceId);
      console.log(`[PayPalSweeper] Bidder #${bidderId} (${lastName}) -> PayPal status: ${liveStatus}`);

      const outcome = await withLock(`bidder-numbers:${spreadsheetId}`, () =>
        applySweepResultLocked(sheets, spreadsheetId, bidderNumbersSheet, rowNumber, snapshotRow, liveStatus, now)
      );
      if (outcome === "resolved") resolved++;
      if (outcome === "escalated") escalated++;
    } catch (rowErr: any) {
      console.error(`[PayPalSweeper] Row ${rowNumber} failed: ${rowErr.message || rowErr}`);
    }
  }

  return { pending, resolved, escalated };
}


/**
 * Applies one pending row's PayPal result, holding the same
 * `bidder-numbers:<spreadsheetId>` lock checkout and bid recording use
 * (ROADMAP.md H5). The sweep's sheet snapshot can be minutes old by the
 * time a row comes up, so this re-reads the row first and leaves it alone
 * unless it is still the same bidder, still pending, and still on the
 * same invoice. Without that, a bidder staff had just marked "Cash" could
 * be overwritten with "Failed Verification - Follow Up Required".
 */
async function applySweepResultLocked(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  bidderNumbersSheet: string,
  rowNumber: number,
  snapshotRow: any[],
  liveStatus: string,
  now: number
): Promise<"resolved" | "escalated" | "changed" | "waiting"> {
  const fresh = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${bidderNumbersSheet}'!A${rowNumber}:L${rowNumber}`,
  });
  const row = fresh.data.values?.[0] || [];
  const stillSamePendingRow =
    String(row[0] ?? "") === String(snapshotRow[0] ?? "") &&
    row[8] === PAYPAL_PENDING_LABEL &&
    String(row[9] ?? "") === String(snapshotRow[9] ?? "");
  if (!stillSamePendingRow) {
    console.log(`[PayPalSweeper] Row ${rowNumber} changed since the sweep started (now '${row[8] ?? ""}'); leaving it alone.`);
    return "changed";
  }

  const bidderId = row[0];
  const firstName = row[1];
  const lastName = row[2];
  const invoiceUrlCell = row[9];
  const amountDue = row[10];
  const timestampStr = row[11];

  if (liveStatus === "PAID" || liveStatus === "MARKED_AS_PAID") {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${bidderNumbersSheet}'!G${rowNumber}:I${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[true, true, "Credit Card / PayPal"]] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${bidderNumbersSheet}'!L${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[""]] },
    });
    return "resolved";
  }

  const initTime = timestampStr ? new Date(timestampStr).getTime() : 0;

  if (!initTime || isNaN(initTime)) {
    // Fallback safety if the timestamp cell is blank: seed it now.
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${bidderNumbersSheet}'!L${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[new Date().toISOString()]] },
    });
    return "waiting";
  }

  if (now - initTime <= TEN_MINUTES_MS) return "waiting";

  console.warn(`[PayPalSweeper] Bidder #${bidderId} verification exceeded the timeout. Escalating to ${PAYPAL_FOLLOW_UP_SHEET}.`);
  await ensureFollowUpSheet(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${PAYPAL_FOLLOW_UP_SHEET}!A:F`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        new Date().toISOString(),
        bidderId,
        `${firstName} ${lastName}`.trim(),
        amountDue,
        invoiceUrlCell,
        `PayPal timeout error. Terminal status remained: '${liveStatus}' after 10 minutes checking execution window.`,
      ]],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${bidderNumbersSheet}'!G${rowNumber}:I${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[false, false, "Failed Verification - Follow Up Required"]] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${bidderNumbersSheet}'!L${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[""]] },
  });
  return "escalated";
}

/**
 * Public entry point - runs the sweep and records the outcome (used by
 * the schedule below, and by the Configuration page's manual "Run Sweep
 * Now" button via the /api/paypal-sweeper/run-now route).
 */
export async function runPaypalSweep(): Promise<PaypalSweepOutcome> {
  const outcome = await runPaypalSweepInner();
  lastRun = { at: new Date().toISOString(), outcome };

  try {
    const db = getAdminFirestore();
    await db.collection(SWEEPER_CREDENTIAL_COLLECTION).doc(SWEEPER_STATUS_DOC).set(lastRun);
  } catch (err: any) {
    console.warn("[Sweeper] Failed to persist run status to Firestore:", err?.message || err);
  }

  return outcome;
}

/**
 * Starts the recurring sweep on a fixed interval - the Node-side
 * replacement for `PayPalSweeper.gs`'s time-driven trigger. Called once
 * from server.ts (never from server/app.ts, which the test suite
 * exercises directly via supertest - tests must never have a background
 * timer running against real/mocked Google APIs on their own schedule).
 *
 * `PAYPAL_SWEEPER_INTERVAL_MINUTES=0` turns the schedule off (returns
 * null). Meant for local development: a local server reads the same
 * Firestore `settings/global` as production, so its sweeper would
 * otherwise sweep the live Bidder-Numbers sheet alongside Cloud Run's.
 * The manual "Run Sweep Now" route still works with the schedule off.
 */
export function startPaypalSweeperSchedule(): NodeJS.Timeout | null {
  if (process.env.PAYPAL_SWEEPER_INTERVAL_MINUTES?.trim() === "0") {
    console.log("[PayPalSweeper] Schedule disabled (PAYPAL_SWEEPER_INTERVAL_MINUTES=0).");
    return null;
  }

  const intervalMinutes = Number(process.env.PAYPAL_SWEEPER_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES;
  const intervalMs = intervalMinutes * 60 * 1000;

  configuredIntervalMinutes = intervalMinutes;
  scheduleStartedAt = Date.now();

  console.log(`[PayPalSweeper] Scheduled to run every ${intervalMinutes} minute(s).`);

  return setInterval(() => {
    runPaypalSweep()
      .then((result) => {
        if ("skipped" in result) {
          console.log(`[PayPalSweeper] Skipped: ${result.skipped}`);
        } else if (result.pending > 0) {
          console.log(`[PayPalSweeper] Swept ${result.pending} pending row(s): ${result.resolved} resolved, ${result.escalated} escalated.`);
        }
      })
      .catch((e) => {
        console.error("[PayPalSweeper] Sweep run failed:", e);
      });
  }, intervalMs);
}
