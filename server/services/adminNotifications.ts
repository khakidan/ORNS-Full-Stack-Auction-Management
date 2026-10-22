import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { BugReportPayload } from "../../src/types";
import { getAuthenticatedClient } from "./oauth";
import { createRawEmail, escapeHtml, getSenderEmail } from "./emailService";
import { getSweeperAuthClient } from "./paypalSweeperJob";

export const BUG_REPORT_NOTIFY_TO = "web-admin@orns.org";
export const BUG_REPORT_NOTIFY_SUBJECT = "New Auction Bug Submitted";

/** Longest slice of the description put in the email; the full report is in the Bug Reports page. */
const DESCRIPTION_PREVIEW_CHARS = 1500;
/** Give up on Gmail after this long, so a hung send can't hold up the person submitting the report. */
const SEND_TIMEOUT_MS = 8000;

// At most EMAIL_LIMIT notification emails per EMAIL_WINDOW_MS across all
// reports. Anyone can submit a report without signing in (bugReportRoutes.ts
// limits that per address, but many addresses add up), and each email is
// sent from a staff member's Gmail. Reports over the limit are still saved;
// the next email that does go out says how many it skipped, so the
// administrator is never left unaware that reports arrived.
const EMAIL_LIMIT = 10;
const EMAIL_WINDOW_MS = 10 * 60 * 1000;
let sentAt: number[] = [];
let skippedSinceLastEmail = 0;

export type NotifyOutcome = "sent" | "throttled" | "no-credential" | "failed";

export function buildBugReportNotificationHtml(report: BugReportPayload, signedIn: boolean, skipped: number, appUrl: string): string {
  const description = report.description.length > DESCRIPTION_PREVIEW_CHARS
    ? `${report.description.slice(0, DESCRIPTION_PREVIEW_CHARS)}... (shortened - open the report for the rest)`
    : report.description;
  const skippedNote = skipped > 0
    ? `<p style="margin: 16px 0; padding: 10px; background: #fef3c7; border: 1px solid #fcd34d;"><strong>${skipped} other report${skipped === 1 ? "" : "s"}</strong> arrived since the last notification email and ${skipped === 1 ? "was" : "were"} not emailed (too many at once). Check the Bug Reports page.</p>`
    : "";
  const row = (label: string, value: string) =>
    `<tr><td style="padding: 6px 12px 6px 0; color: #64748b; vertical-align: top; white-space: nowrap;">${label}</td><td style="padding: 6px 0;">${escapeHtml(value)}</td></tr>`;

  return `<div style="font-family: sans-serif; max-width: 600px; color: #1e293b;">
  <h2 style="margin: 0 0 12px;">New Auction Bug Submitted</h2>
  <p style="margin: 0 0 16px;">Someone sent a new report that needs your attention.</p>
  <table style="border-collapse: collapse; font-size: 14px;">
    ${row("Title", report.title)}
    ${row("Type", report.type)}
    ${row("Page", report.route)}
    ${row("Time", report.timestamp)}
    ${row("Sent by", signedIn ? "A signed-in staff member" : "Someone who was not signed in")}
    ${row("Description", description)}
  </table>
  ${skippedNote}
  <p style="margin: 16px 0 0;">Open <strong>Bug Reports</strong> (left sidebar, System section) in the app to read the full report, copy it for a fix, and mark it resolved: <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a></p>
</div>`;
}

/**
 * Emails web-admin@orns.org that a bug report was just submitted, so a
 * report can't be sent without the administrator hearing about it.
 *
 * Sends as the staff member who signed in most recently (the same stored
 * credential the PayPal sweeper uses, since an anonymous report has no
 * session of its own), falling back to the submitter's own session. Never
 * throws: the report is already saved, and a notification problem must not
 * turn that into an error. Awaited by the route rather than run after the
 * response, because Cloud Run throttles CPU once the response is sent.
 */
export async function notifyAdminOfBugReport(
  report: BugReportPayload,
  sessionTokens: { access_token?: string | null; refresh_token?: string | null } | null | undefined,
  now = Date.now(),
  timeoutMs = SEND_TIMEOUT_MS
): Promise<NotifyOutcome> {
  sentAt = sentAt.filter((t) => now - t < EMAIL_WINDOW_MS);
  if (sentAt.length >= EMAIL_LIMIT) {
    skippedSinceLastEmail++;
    console.warn(`[BugReport] Notification email skipped (limit of ${EMAIL_LIMIT} per ${EMAIL_WINDOW_MS / 60000} minutes); the report is saved.`);
    return "throttled";
  }

  const candidates: OAuth2Client[] = [];
  const background = await getSweeperAuthClient();
  if (background) candidates.push(background);
  if (sessionTokens) candidates.push(getAuthenticatedClient(sessionTokens));
  if (candidates.length === 0) {
    console.warn(`[BugReport] No Google sign-in available to email "${BUG_REPORT_NOTIFY_SUBJECT}". The report is saved; an administrator needs to sign in once so notifications can be sent.`);
    return "no-credential";
  }

  const appUrl = (process.env.APP_URL?.trim() || "https://orns-auction-manager.cloud.run").replace(/^(?!https?:\/\/)/i, "https://");
  const skipped = skippedSinceLastEmail;
  const html = buildBugReportNotificationHtml(report, !!sessionTokens, skipped, appUrl);

  for (const client of candidates) {
    let timer: NodeJS.Timeout | undefined;
    try {
      const send = (async () => {
        const senderEmail = await getSenderEmail(client);
        const raw = createRawEmail(BUG_REPORT_NOTIFY_TO, BUG_REPORT_NOTIFY_SUBJECT, html, "ORNS Auction Manager", senderEmail);
        await google.gmail({ version: "v1", auth: client }).users.messages.send({ userId: "me", requestBody: { raw } });
      })();
      send.catch(() => {}); // a send that loses the race below must not become an unhandled rejection
      await Promise.race([
        send,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Gmail did not answer in time")), timeoutMs); }),
      ]);
      sentAt.push(now);
      skippedSinceLastEmail = Math.max(0, skippedSinceLastEmail - skipped);
      return "sent";
    } catch (error: any) {
      console.error("[BugReport] Notification email failed with one sign-in:", error?.message || error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  console.error(`[BugReport] Couldn't email "${BUG_REPORT_NOTIFY_SUBJECT}" to ${BUG_REPORT_NOTIFY_TO}. The report is saved; check the Bug Reports page.`);
  return "failed";
}

/** Test-only: forget the send history and skipped count. */
export function _resetAdminNotificationsForTesting(): void {
  sentAt = [];
  skippedSinceLastEmail = 0;
}
