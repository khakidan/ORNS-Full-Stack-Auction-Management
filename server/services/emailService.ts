import { google, sheets_v4 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { withLock } from "../utils/asyncLock";
import { ensureTrackingHeaders } from "../utils/bidderNumbersHeaders";
import { PayPalService } from "./paypalService";
import { attachInvoice, buildBidderReceipt, BidderReceiptWithInvoice, DEFAULT_SHEET_NAMES, SheetNames } from "./receiptDataService";
import { quoteSheetName } from "../utils/rangeUtils";
import { isValidEmailAddress } from "../utils/emailAddress";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";

/**
 * Bidder-Numbers columns M/N record each receipt email: when it was sent,
 * and which invoice link it carried. Batch email-all skips a bidder whose
 * column N already matches their current invoice, so a retried or
 * re-clicked batch never emails the same receipt twice (ROADMAP.md H3).
 */
const EMAILED_AT_COL = "M";
const EMAILED_INVOICE_COL = "N";
export const EMAILED_INVOICE_INDEX = 13; // 0-based index of column N

/** Escapes text for an HTML body or a double-quoted attribute. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** Only an http(s) link may become the button's href - anything else (e.g. `javascript:`) is dropped. */
function safeHref(url: string): string {
  return /^https?:\/\//i.test(url.trim()) ? escapeHtml(url.trim()) : "#";
}

export function generateEmailHtml(receipt: any, paymentUrl: string, adjustedTotal: string, feeAmount: string): string {
  const itemRows = receipt.itemsWon.map((id: string, i: number) => `
      <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee;">${escapeHtml(id)}</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee;">${escapeHtml(receipt.itemNames[i])}</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee; text-align: right;">$${Number(receipt.itemPrices[i]).toFixed(2)}</td>
      </tr>
  `).join('');

  return `
  <html>
  <head>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Raleway:ital,wght@0,400;1,400&family=Mr+De+Haviland&family=Source+Code+Pro:wght@400;700&display=swap" rel="stylesheet">
  </head>
  <body style="margin: 0; padding: 0; background-color: #ffffff;">
      <div style="max-width: 600px; margin: auto; padding: 40px 20px; font-family: 'Raleway', sans-serif; color: #000000;">
          <p>Thank you for supporting Orchard Ridge Nursery School's Auction. Your donations today will ensure that we can continue to provide high quality preschool education.</p>
          <h1 style="font-family: 'Inter', sans-serif; font-size: 18px; font-weight: bold; margin-bottom: 5px;">
              Receipt for ${escapeHtml(receipt.firstName)} ${escapeHtml(receipt.lastName)}
          </h1>
          <p style="font-size: 11px; margin-top: 0; color: #444444;">Bidder #${escapeHtml(receipt.bidId)}</p>
          <p style="font-size: 11px; line-height: 1.5; margin-top: 20px;">The following items have been purchased:</p>
          <table style="width: 100%; border-collapse: collapse; font-family: 'Source Code Pro', monospace; font-size: 10px; margin-top: 15px;">
              <thead>
                  <tr style="text-align: left; font-weight: bold; color: #e31b23;">
                      <th style="padding-bottom: 10px; border-bottom: 2px solid #e31b23;">ID</th>
                      <th style="padding-bottom: 10px; border-bottom: 2px solid #e31b23;">Item Name</th>
                      <th style="padding-bottom: 10px; border-bottom: 2px solid #e31b23; text-align: right;">Amount</th>
                  </tr>
              </thead>
              <tbody>${itemRows}</tbody>
          </table>
          <div style="text-align: center; margin-top: 15px; font-family: 'Inter', sans-serif; font-size: 24px; font-weight: bold;">
              Subtotal for cash or check: $${receipt.totalCost.toFixed(2)}
          </div>
          <div style="margin-top: 25px; padding: 15px; border: 1px solid #eee; background-color: #fafafa;">
              <p style="margin-top: 0;">Do you still need to pay? Cash or checks are preferred, but if you wish to pay by credit card, here's the link to pay.</p>
              <p style="text-align: center;">
                  <a href="${safeHref(paymentUrl)}" style="background-color: #e31b23; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                      Pay $${escapeHtml(adjustedTotal)} via PayPal
                  </a>
              </p>
              <p style="font-size: 11px; color: #666; text-align: center;">(Includes a 3.49% + $0.49 processing fee of $${escapeHtml(feeAmount)})</p>
          </div>
          <div style="margin-top: 30px;">
              <p>Thanks again,</p>
              <p style="font-family: 'Mr De Haviland', cursive; font-size: 32px; margin: 0.25em 0;">Elizabeth Burke</p>
              <p style="font-size: 10px; color: #666666;">Orchard Ridge Nursery School</p>
              <p style="font-size: 8px; color: #666666; font-style: italic;">Orchard Ridge Nursery School is a registered 501(c)(3) nonprofit organization.<br />Federal Tax ID No: 39-1501336</p>
          </div>
          <hr style="border:none; border-top:1px solid #eee; margin: 20px 0;">
          <p style="color: #666666; font-size: 11px; line-height: 1.5; text-align: center;">
            ORCHARD RIDGE NURSERY SCHOOL<br>
            1025 MCKENNA BOULEVARD, MADISON, WI | 608.274.8407
          </p>
          <p style="color: #666666; font-size: 11px; font-style: italic; line-height: 1.5; text-align: center;">
            <strong>Notice:</strong> This is an automated message from an unmonitored address. 
            Please do not reply directly to this email. For questions regarding the auction or 
            your receipt, please contact <strong>director@orns.org</strong>.
          </p>
      </div>
  </body>
  </html>`;
}

/** Removes CR/LF so a value can never end its header line and start a new one (e.g. an injected `Bcc:`). */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047-encodes a header value that isn't plain ASCII, so names like "José" arrive intact. */
function encodeHeaderText(value: string): string {
  const clean = headerSafe(value);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf-8").toString("base64")}?=`;
}

export { isValidEmailAddress };

export function createRawEmail(to: string, subject: string, htmlBody: string, fromName?: string, fromEmail?: string): string {
  // A plain-ASCII display name is quoted; an RFC 2047-encoded one must
  // not be (encoded words aren't allowed inside a quoted string).
  const encodedFromName = fromName ? encodeHeaderText(fromName) : "";
  const fromDisplay = !encodedFromName ? "" : encodedFromName.startsWith("=?") ? encodedFromName : `"${encodedFromName.replace(/"/g, "")}"`;
  const headers = [
    `To: ${headerSafe(to)}`,
    fromDisplay && fromEmail ? `From: ${fromDisplay} <${headerSafe(fromEmail)}>` : (fromDisplay ? `From: ${fromDisplay}` : ""),
    `Subject: ${encodeHeaderText(subject)}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `MIME-Version: 1.0`
  ].filter(Boolean);

  const message = [
    ...headers,
    ``,
    htmlBody
  ].join("\r\n");

  return Buffer.from(message, 'utf-8').toString("base64").replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The signed-in staff member's address, used as the From: address. Falls back to Gmail's "me". */
export async function getSenderEmail(client: OAuth2Client): Promise<string> {
  try {
    const userInfo = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
    if (userInfo.data.email) return userInfo.data.email;
  } catch (e) {
    console.warn("Could not retrieve user info profile for sender email:", e);
  }
  return "me";
}

/**
 * Sends one receipt email. The "Pay $X" button shows the invoice's own
 * total (`adjustedTotal`) and links to that same invoice (`paymentUrl`),
 * so the email can never advertise a different amount than the link
 * actually charges (ROADMAP.md H2).
 */
export async function sendReceiptEmail(client: OAuth2Client, receipt: BidderReceiptWithInvoice, senderEmail: string): Promise<void> {
  const feeAmount = Math.round((receipt.adjustedTotal - receipt.totalCost) * 100) / 100;
  const htmlBody = generateEmailHtml(receipt, receipt.paymentUrl, receipt.adjustedTotal.toFixed(2), feeAmount.toFixed(2));
  const raw = createRawEmail(receipt.email.trim(), `Your Auction Receipt: ${receipt.firstName} ${receipt.lastName}`, htmlBody, "Orchard Ridge Nursery School", senderEmail);

  await google.gmail({ version: "v1", auth: client }).users.messages.send({
    userId: "me",
    requestBody: { raw }
  });
}

/** Records in Bidder-Numbers M/N that this row's receipt was just emailed with this invoice link. */
export async function recordReceiptEmailed(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  rowIndex: number,
  paymentUrl: string,
  bidderNumbersSheet = DEFAULT_SHEET_NAMES.bidderNumbers
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(bidderNumbersSheet)}!${EMAILED_AT_COL}${rowIndex}:${EMAILED_INVOICE_COL}${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[new Date().toISOString(), paymentUrl]] },
  });
  clearCacheForSpreadsheet(spreadsheetId);
}

/**
 * Emails one bidder their receipt (the single "Email" button). Always
 * sends - this is an explicit, per-bidder action - and records it in M/N.
 *
 * Resolves the bidder's PayPal invoice first, exactly as receipt
 * generation does (ROADMAP.md H2): it used to link whatever URL was cached
 * in Column J (possibly for an old total, or already cancelled), or a bare
 * paypal.com link when there was none. Must not be called while holding
 * the `bidder-numbers:` lock - it takes that lock itself, only around the
 * invoice step.
 */
export async function processEmail(
  client: OAuth2Client,
  spreadsheetId: string,
  bidderId: string,
  itemsSpreadsheetId: string,
  paypal: PayPalService,
  sheetNames: SheetNames = DEFAULT_SHEET_NAMES
): Promise<{ success: true } | { success: false; error: string }> {
  const built = await buildBidderReceipt(client, spreadsheetId, itemsSpreadsheetId, bidderId, sheetNames);
  if (built.success === false) return built;

  const email = built.receipt.email.trim();
  if (!email) return { success: false, error: "No email address found for this bidder." };
  if (!isValidEmailAddress(email)) return { success: false, error: `The email address on file for bidder ${bidderId} isn't valid: "${email}".` };

  const attached = await withLock(`bidder-numbers:${spreadsheetId}`, () =>
    attachInvoice(client, spreadsheetId, built.receipt, paypal, sheetNames)
  );
  if (attached.success === false) return attached;

  await sendReceiptEmail(client, attached.receipt, await getSenderEmail(client));

  const sheets = google.sheets({ version: "v4", auth: client });
  await recordReceiptEmailed(sheets, spreadsheetId, attached.rowIndex, attached.receipt.paymentUrl, sheetNames.bidderNumbers);
  await ensureTrackingHeaders(sheets, spreadsheetId, sheetNames.bidderNumbers).catch((e) => console.warn("[processEmail] Could not label Bidder-Numbers L1:O1:", e?.message || e));

  return { success: true };
}
