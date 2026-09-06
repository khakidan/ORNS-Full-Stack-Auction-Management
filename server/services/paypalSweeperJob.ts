import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { getOAuthClient } from "./oauth";
import { getAdminFirestore } from "./firebaseAdmin";
import { PayPalService } from "./paypalService";

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
const TEN_MINUTES_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MINUTES = 5;

export async function persistSweeperCredential(refreshToken: string, updatedBy: string): Promise<void> {
  const db = getAdminFirestore();
  await db.collection(SWEEPER_CREDENTIAL_COLLECTION).doc(SWEEPER_CREDENTIAL_DOC).set({
    refreshToken,
    updatedBy,
    updatedAt: new Date().toISOString(),
  });
}

async function getSweeperAuthClient(): Promise<OAuth2Client | null> {
  const db = getAdminFirestore();
  const snap = await db.collection(SWEEPER_CREDENTIAL_COLLECTION).doc(SWEEPER_CREDENTIAL_DOC).get();
  const refreshToken = snap.data()?.refreshToken;
  if (!refreshToken) return null;

  const client = getOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export interface PaypalSweepResult {
  pending: number;
  resolved: number;
  escalated: number;
}

export type PaypalSweepOutcome = PaypalSweepResult | { skipped: string };

async function ensureFollowUpSheet(sheets: ReturnType<typeof google.sheets>, spreadsheetId: string): Promise<void> {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = metadata.data.sheets?.some((s) => s.properties?.title === "Follow-Up");
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: "Follow-Up" } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Follow-Up!A1:F1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Timestamp", "Bidder Number", "Name", "Amount Flagged", "Invoice URL", "System Notes"]] },
  });
}

/**
 * Scans `Bidder-Numbers` for the `"PayPal Verification Pending"` marker
 * (Code Hardening item #2, Step 3's deferred credit-card path) and either
 * resolves it (PayPal now shows the invoice paid) or escalates it to
 * `Follow-Up` once it's been pending longer than 10 minutes - mirrors
 * `PayPalSweeper.gs`'s `checkPendingPayPalInvoices` exactly, evaluating
 * rows bottom-up. One row's failure is logged and skipped rather than
 * aborting the whole sweep.
 */
export async function runPaypalSweep(): Promise<PaypalSweepOutcome> {
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
    const row = rows[i];
    const methodLabel = row[8];
    if (methodLabel !== "PayPal Verification Pending") continue;
    pending++;

    const rowNumber = i + 1;
    const bidderId = row[0];
    const firstName = row[1];
    const lastName = row[2];
    const invoiceUrlCell = row[9];
    const amountDue = row[10];
    const timestampStr = row[11];

    try {
      const invoiceId = paypal.extractInvoiceIdFromUrl(invoiceUrlCell);
      if (!invoiceId) {
        console.warn(`[PayPalSweeper] Row ${rowNumber}: pending but no evaluable Invoice ID.`);
        continue;
      }

      const liveStatus = await paypal.getInvoiceStatus(invoiceId);
      console.log(`[PayPalSweeper] Bidder #${bidderId} (${lastName}) -> PayPal status: ${liveStatus}`);

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
        resolved++;
        continue;
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
        continue;
      }

      if (now - initTime > TEN_MINUTES_MS) {
        console.warn(`[PayPalSweeper] Bidder #${bidderId} verification exceeded the timeout. Escalating to Follow-Up.`);
        await ensureFollowUpSheet(sheets, spreadsheetId);
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Follow-Up!A:F",
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
        escalated++;
      }
    } catch (rowErr: any) {
      console.error(`[PayPalSweeper] Row ${rowNumber} failed: ${rowErr.message || rowErr}`);
    }
  }

  return { pending, resolved, escalated };
}

/**
 * Starts the recurring sweep on a fixed interval - the Node-side
 * replacement for `PayPalSweeper.gs`'s time-driven trigger. Called once
 * from server.ts (never from server/app.ts, which the test suite
 * exercises directly via supertest - tests must never have a background
 * timer running against real/mocked Google APIs on their own schedule).
 */
export function startPaypalSweeperSchedule(): NodeJS.Timeout {
  const intervalMinutes = Number(process.env.PAYPAL_SWEEPER_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES;
  const intervalMs = intervalMinutes * 60 * 1000;

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
