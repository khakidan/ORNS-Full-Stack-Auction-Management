import { google, script_v1, sheets_v4 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { withLock } from "../utils/asyncLock";
import { PayPalService } from "./paypalService";
import { EMAILED_INVOICE_INDEX, RECEIPT_EMAIL_HEADERS, getSenderEmail, isValidEmailAddress, recordReceiptEmailed, sendReceiptEmail } from "./emailService";
import { BidderReceiptData, buildAllBidderReceiptsWithInvoices, findExistingInvoice } from "./receiptDataService";

export async function createIndividualReceipt(script: script_v1.Script, scriptId: string, bidderId: string, receiptData: BidderReceiptData) {
    const response = await script.scripts.run({
        scriptId,
        requestBody: {
          function: "apiCreateIndividualReceipt",
          // folderID (2nd position) has never actually been wired through
          // from Node - kept as an explicit null so receiptData lands in
          // the same 3rd position Class_GoogleAIStudio.gs's function
          // signature expects, rather than silently shifting it.
          parameters: [String(bidderId), null, receiptData],
          devMode: true,
        },
      });
      if (response.data.error) throw new Error(response.data.error.message);
      return response.data.response?.result;
}

export async function createAllReceipts(script: script_v1.Script, scriptId: string, receipts: BidderReceiptData[]) {
    const response = await script.scripts.run({
        scriptId,
        requestBody: {
          function: "apiCreateAllReceipts",
          parameters: [null, receipts],
          devMode: true,
        },
      });
      if (response.data.error) throw new Error(response.data.error.message);
      return response.data.response?.result;
}

export interface EmailAllResult {
    /** Receipts emailed by this run. */
    sentCount: number;
    /** Bidders skipped because this exact receipt (same invoice) was already emailed. */
    alreadySentCount: number;
    /** Bidders whose email failed (invalid address, Gmail error) - logged, batch continues. */
    failedCount: number;
}

/**
 * Emails every bidder with winning items and a valid email address their
 * receipt, each linking to their current PayPal invoice (ROADMAP.md H2/H3).
 *
 * 1. Under the `bidder-numbers:` lock, resolves every invoice once
 *    (buildAllBidderReceiptsWithInvoices - reads the three sheets once,
 *    saves each new invoice to J/K immediately).
 * 2. Outside the lock, emails each bidder, skipping any whose Column N
 *    already records an email for this same invoice - so re-running the
 *    batch (a client retry, a second click) never re-sends a receipt
 *    nothing has changed on, while a bidder whose total changed (new
 *    invoice) does get the new one.
 * 3. Records each send in M/N right after it succeeds. If that record
 *    can't be written, the batch stops: carrying on would leave more sent
 *    emails unrecorded, and a re-run would send those again.
 */
export async function processAllEmails(
    client: OAuth2Client,
    spreadsheetId: string,
    itemsSpreadsheetId: string,
    paypal: PayPalService
): Promise<EmailAllResult> {
    const sheets = google.sheets({ version: "v4", auth: client });

    const receipts = await withLock(`bidder-numbers:${spreadsheetId}`, () =>
        buildAllBidderReceiptsWithInvoices(client, spreadsheetId, itemsSpreadsheetId, paypal, (r) => isValidEmailAddress(r.email.trim()))
    );

    const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bidder-Numbers'!A:N" });
    const bidderRows = bNum.data.values || [];
    await ensureReceiptEmailHeaders(sheets, spreadsheetId, bidderRows[0] || []);

    const senderEmail = await getSenderEmail(client);
    const result: EmailAllResult = { sentCount: 0, alreadySentCount: 0, failedCount: 0 };

    for (const receipt of receipts) {
        const existing = findExistingInvoice(bidderRows, receipt.bidId);
        if (!existing) continue;
        const emailedInvoice = String(bidderRows[existing.rowIndex - 1]?.[EMAILED_INVOICE_INDEX] || "").trim();
        if (emailedInvoice && emailedInvoice === receipt.paymentUrl) {
            result.alreadySentCount++;
            continue;
        }

        try {
            await sendReceiptEmail(client, receipt, senderEmail);
        } catch (e: any) {
            // One bidder's bad data or a Gmail error must not abort the
            // whole batch and silently skip every remaining receipt.
            console.error(`[processAllEmails] Failed to email bidder ${receipt.bidId}:`, e.message || e);
            result.failedCount++;
            continue;
        }
        result.sentCount++;

        try {
            await recordReceiptEmailed(sheets, spreadsheetId, existing.rowIndex, receipt.paymentUrl);
        } catch (e: any) {
            throw new Error(
                `Stopped emailing receipts after ${result.sentCount} sent: bidder ${receipt.bidId}'s receipt was emailed but couldn't be recorded in Bidder-Numbers row ${existing.rowIndex} (M/N), ` +
                `so re-running now would email them again. Cause: ${e.message || e}`
            );
        }
    }
    return result;
}

/** Labels columns M/N on the Bidder-Numbers header row the first time receipts are batch-emailed. */
async function ensureReceiptEmailHeaders(sheets: sheets_v4.Sheets, spreadsheetId: string, headerRow: any[]): Promise<void> {
    if (headerRow[12] && headerRow[13]) return;
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "'Bidder-Numbers'!M1:N1",
        valueInputOption: "RAW",
        requestBody: { values: [RECEIPT_EMAIL_HEADERS] },
    });
}
