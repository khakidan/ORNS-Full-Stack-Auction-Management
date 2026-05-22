import { google } from "googleapis";
import { calculatePayPalSurcharge } from "../utils/financeUtils";

export function generateEmailHtml(receipt: any, paymentUrl: string, adjustedTotal: string, feeAmount: string): string {
  const itemRows = receipt.itemsWon.map((id: string, i: number) => `
      <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee;">${id}</td>
          <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee;">${receipt.itemNames[i]}</td>
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
              Receipt for ${receipt.firstName} ${receipt.lastName}
          </h1>
          <p style="font-size: 11px; margin-top: 0; color: #444444;">Bidder #${receipt.bidId}</p>
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
                  <a href="${paymentUrl}" style="background-color: #e31b23; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                      Pay $${adjustedTotal} via PayPal
                  </a>
              </p>
              <p style="font-size: 11px; color: #666; text-align: center;">(Includes a 3.49% + $0.49 processing fee of $${feeAmount})</p>
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

export function createRawEmail(to: string, subject: string, htmlBody: string, fromName?: string, fromEmail?: string): string {
  const headers = [
    `To: ${to}`,
    fromName && fromEmail ? `From: "${fromName}" <${fromEmail}>` : (fromName ? `From: "${fromName}"` : ""),
    `Subject: ${subject}`,
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

export async function processEmail(client: any, spreadsheetId: string, bidderId: string) {
  const sheets = google.sheets({ version: "v4", auth: client });
  const bMgmt = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bid-Management!A1:ZZ1000" });
  const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bidder-Numbers!A:L" });
  const aucItems = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Auction-Items!A:Z" });

  const numData = bNum.data.values || [];
  let email = '';
  let firstName = '';
  let lastName = '';
  let invoiceUrl = '';
  
  for (let i = 1; i < numData.length; i++) {
    if (String(numData[i][0]).trim() === String(bidderId).trim()) {
      firstName = numData[i][1];
      lastName = numData[i][2];
      email = numData[i][3];
      invoiceUrl = numData[i][9]; 
      break;
    }
  }

  if (!email) return { success: false, error: "No email address found for this bidder." };

  const mgmtData = bMgmt.data.values || [];
  let colIndex = -1;
  const headerRow = mgmtData[0] || [];
  for (let c = 0; c < headerRow.length; c += 2) {
    if (String(headerRow[c]).trim() === String(bidderId).trim()) {
      colIndex = c;
      break;
    }
  }

  if (colIndex === -1) return { success: false, error: "Bidder not found in Bid-Management matrix." };

  // Determine dynamic column indices for Auction-Items
  const itemsRows = aucItems.data.values || [];
  const itemsHead = itemsRows[0] || [];
  const itemsHeadLower = itemsHead.map(h => String(h || "").toLowerCase().trim());
  
  const getCol = (names: string[], defaultIdx: number) => {
    const idx = itemsHeadLower.findIndex(h => names.some(n => h === n || h.includes(n)));
    return idx !== -1 ? idx : defaultIdx;
  };

  const itemIdIdx = getCol(["item number", "number", "id"], 0);
  const itemNameIdx = getCol(["item name", "name"], 2);

  const itemsWon: string[] = [];
  const itemNames: string[] = [];
  const itemPrices: number[] = [];
  let totalCost = 0;

  for (let r = 3; r < mgmtData.length; r++) {
    const row = mgmtData[r];
    const itemId = row[colIndex];
    if (itemId) {
      const price = parseFloat(String(row[colIndex + 1]).replace(/[^0-9.]/g, '')) || 0;
      itemsWon.push(String(itemId));
      itemPrices.push(price);
      totalCost += price;

      let iName = "Unknown Item";
      for (let j = 1; j < itemsRows.length; j++) {
        const itemRow = itemsRows[j];
        if (String(itemRow[itemIdIdx] || "").trim() === String(itemId).trim()) {
          iName = itemRow[itemNameIdx] || "Unknown Item";
          break;
        }
      }
      itemNames.push(iName);
    }
  }

  if (itemsWon.length === 0) return { success: false, error: "No items won for this bidder." };

  const receipt = {
    bidId: bidderId,
    firstName,
    lastName,
    itemsWon,
    itemNames,
    itemPrices,
    totalCost
  };

  const fees = calculatePayPalSurcharge(totalCost);
  const paymentUrl = invoiceUrl || "https://www.paypal.com";
  
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  let senderEmail = 'me';
  try {
    const userInfo = await oauth2.userinfo.get();
    if (userInfo.data.email) {
      senderEmail = userInfo.data.email;
    }
  } catch (e) {
    console.warn("Could not retrieve user info profile for sender email:", e);
  }

  const htmlBody = generateEmailHtml(receipt, paymentUrl, fees.total.toFixed(2), fees.surcharge.toFixed(2));
  const raw = createRawEmail(email, `Your Auction Receipt: ${firstName} ${lastName}`, htmlBody, "Orchard Ridge Nursery School", senderEmail);
  
  const gmail = google.gmail({ version: "v1", auth: client });
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw }
  });

  return { success: true };
}
