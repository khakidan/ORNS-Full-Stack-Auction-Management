import { google, script_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { processEmail } from "./emailService";
import { BidderReceiptData } from "./receiptDataService";

export async function createIndividualReceipt(script: script_v1.Script, scriptId: string, bidderId: string, emailReceipt: boolean, receiptData: BidderReceiptData) {
    const response = await script.scripts.run({
        scriptId,
        requestBody: {
          function: "apiCreateIndividualReceipt",
          // folderID (3rd position) has never actually been wired through
          // from Node - kept as an explicit null so receiptData lands in
          // the same 4th position Class_GoogleAIStudio.gs's function
          // signature expects, rather than silently shifting it.
          parameters: [String(bidderId), !!emailReceipt, null, receiptData],
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

export async function processAllEmails(client: OAuth2Client, spreadsheetId: string, itemsSpreadsheetId: string) {
    const sheets = google.sheets({ version: "v4", auth: client });
    const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bidder-Numbers'!A:L" });
    const numData = bNum.data.values || [];
    let sentCount = 0;

    for (let i = 1; i < numData.length; i++) {
        const id = String(numData[i][0] || "").trim();
        const email = String(numData[i][3] || "").trim();
        if (id && email) {
            try {
                const r = await processEmail(client, spreadsheetId, id, itemsSpreadsheetId);
                if (r.success) sentCount++;
            } catch (e: any) {
                // One bidder's bad/corrupted data (e.g. a negative item price
                // reaching calculatePayPalSurcharge) must not abort the whole
                // batch and silently skip every remaining bidder's receipt.
                console.error(`[processAllEmails] Failed to email bidder ${id}:`, e.message || e);
            }
        }
    }
    return sentCount;
}
