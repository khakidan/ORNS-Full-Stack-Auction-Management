import { google, script_v1 } from "googleapis";
import { runAppsScript } from "../utils/appsScriptRun";
import { OAuth2Client } from "google-auth-library";
import { withLock } from "../utils/asyncLock";
import { ensureTrackingHeaders } from "../utils/bidderNumbersHeaders";
import { PayPalService } from "./paypalService";
import { EMAILED_INVOICE_INDEX, getSenderEmail, isValidEmailAddress, recordReceiptEmailed, sendReceiptEmail } from "./emailService";
import { BidderReceiptData, buildAllBidderReceiptsWithInvoices, DEFAULT_SHEET_NAMES, findExistingInvoice, SheetNames } from "./receiptDataService";
import { quoteSheetName } from "../utils/rangeUtils";

/**
 * Both return the script's result as-is - check `isAppsScriptFailure`,
 * since the bridge functions report their own errors as
 * `{ success: false, error }` rather than failing the run.
 */
export async function createIndividualReceipt(script: script_v1.Script, scriptId: string, bidderId: string, receiptData: BidderReceiptData) {
    // folderID (2nd position) has never actually been wired through from
    // Node - kept as an explicit null so receiptData lands in the same 3rd
    // position Class_GoogleAIStudio.gs's function signature expects,
    // rather than silently shifting it.
    return runAppsScript(script, scriptId, "apiCreateIndividualReceipt", [String(bidderId), null, receiptData]);
}

/**
 * Bidders per "Print all receipts" request. Each part is its own Apps
 * Script run and its own PDF, so no single run gets near Apps Script's
 * 6-minute limit - a run cut off there leaves a half-written PDF.
 */
export const RECEIPTS_PER_PART = 25;

/**
 * Writes `receipts` into one PDF named `fileName`. (Without a file name,
 * the script makes its old "1st Half"/"2nd Half" pair instead.)
 */
export async function createAllReceipts(script: script_v1.Script, scriptId: string, receipts: BidderReceiptData[], fileName?: string) {
    return runAppsScript(script, scriptId, "apiCreateAllReceipts", fileName ? [null, receipts, fileName] : [null, receipts]);
}

/** e.g. "Receipts - Part 2 of 4 (Garcia - Lopez)" */
export function receiptPartFileName(part: number, totalParts: number, receipts: BidderReceiptData[]): string {
    const first = receipts[0]?.lastName || "";
    const last = receipts[receipts.length - 1]?.lastName || "";
    const range = first && last ? ` (${first === last ? first : `${first} - ${last}`})` : "";
    return `Receipts - Part ${part} of ${totalParts}${range}`;
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
    paypal: PayPalService,
    sheetNames: SheetNames = DEFAULT_SHEET_NAMES
): Promise<EmailAllResult> {
    const sheets = google.sheets({ version: "v4", auth: client });

    const receipts = await withLock(`bidder-numbers:${spreadsheetId}`, () =>
        buildAllBidderReceiptsWithInvoices(client, spreadsheetId, itemsSpreadsheetId, paypal, {
            include: (r) => isValidEmailAddress(r.email.trim()),
            sheetNames,
        })
    );

    const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${quoteSheetName(sheetNames.bidderNumbers)}!A:N` });
    const bidderRows = bNum.data.values || [];
    await ensureTrackingHeaders(sheets, spreadsheetId, sheetNames.bidderNumbers).catch((e) => console.warn("[processAllEmails] Could not label Bidder-Numbers L1:O1:", e?.message || e));

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
            await recordReceiptEmailed(sheets, spreadsheetId, existing.rowIndex, receipt.paymentUrl, sheetNames.bidderNumbers);
        } catch (e: any) {
            throw new Error(
                `Stopped emailing receipts after ${result.sentCount} sent: bidder ${receipt.bidId}'s receipt was emailed but couldn't be recorded in ${sheetNames.bidderNumbers} row ${existing.rowIndex} (M/N), ` +
                `so re-running now would email them again. Cause: ${e.message || e}`
            );
        }
    }
    return result;
}
