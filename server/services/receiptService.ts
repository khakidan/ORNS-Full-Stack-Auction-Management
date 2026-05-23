import { google } from "googleapis";
import { processEmail } from "./emailService";

export async function createIndividualReceipt(script: any, scriptId: string, bidderId: string, emailReceipt: boolean) {
    const response = await script.scripts.run({
        scriptId,
        requestBody: {
          function: "apiCreateIndividualReceipt",
          parameters: [String(bidderId), !!emailReceipt],
          devMode: true,
        },
      });
      if (response.data.error) throw new Error(response.data.error.message);
      return response.data.response?.result;
}

export async function createAllReceipts(script: any, scriptId: string) {
    const response = await script.scripts.run({
        scriptId,
        requestBody: {
          function: "apiCreateAllReceipts",
          parameters: [],
          devMode: true,
        },
      });
      if (response.data.error) throw new Error(response.data.error.message);
      return response.data.response?.result;
}

export async function processAllEmails(client: any, spreadsheetId: string) {
    const sheets = google.sheets({ version: "v4", auth: client });
    const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bidder-Numbers'!A:L" });
    const numData = bNum.data.values || [];
    let sentCount = 0;
    
    for (let i = 1; i < numData.length; i++) {
        const id = String(numData[i][0] || "").trim();
        const email = String(numData[i][3] || "").trim();
        if (id && email) {
            const r = await processEmail(client, spreadsheetId, id);
            if (r.success) sentCount++;
        }
    }
    return sentCount;
}
