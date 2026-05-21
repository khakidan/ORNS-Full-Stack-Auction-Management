import { google } from "googleapis";

export function calculatePayPalSurcharge(bidAmount: number) {
  const percentRate = 0.0349;
  const fixedFee = 0.49;
  const totalInvoiceAmount = (bidAmount + fixedFee) / (1 - percentRate);
  
  const roundedTotal = Math.round(totalInvoiceAmount * 100) / 100;
  const surchargeAmount = Math.round((roundedTotal - bidAmount) * 100) / 100;
  
  return {
    total: roundedTotal,
    surcharge: surchargeAmount
  };
}

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

export async function performSheetSync(client: any, spreadsheetId: string, customAuctionImportSheetID?: string, customAuctionTicketSheetsID?: string) {
  const sheets = google.sheets({ version: "v4", auth: client });

  console.log(`[Sync] --- STARTING INTEGRATED NODE.JS SHEET SYNC TRANSITION ---`);
  console.log(`[Sync] Spreadsheet target ID: ${spreadsheetId}`);

  // Step 1: Load Settings
  console.log(`[Sync Step 1] Fetching settings list from _Settings sheet...`);
  const settingsRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "_Settings!A:C"
  }).catch(() => ({ data: { values: [] } }));
  const settingsRows = settingsRes.data.values || [];
  const settingsMap: Record<string, string> = {};
  for (const row of settingsRows) {
    if (row[0] && row[0] !== "Setting Key") {
      settingsMap[row[0]] = String(row[1] || "").trim();
    }
  }

  const auctionImportSheetID = customAuctionImportSheetID || settingsMap["auctionImportSheetID"];
  const auctionTicketSheetsID = customAuctionTicketSheetsID || settingsMap["auctionTicketSheetsID"];
  const ticketPriceVal = parseFloat(settingsMap["ticketPrice"] || "35") || 35;

  console.log(`[Sync Config] Master Ticket sales file ID: ${auctionTicketSheetsID}`);
  console.log(`[Sync Config] Master Catalog registry item file ID: ${auctionImportSheetID}`);
  console.log(`[Sync Config] Walk-In standard ticket cost: $${ticketPriceVal}`);

  if (!auctionTicketSheetsID) {
    throw new Error("Missing 'auctionTicketSheetsID' in settings. Please configure settings first.");
  }

  // Step 2: Query sheet list of spreadsheet
  console.log(`[Sync Step 2] Inspecting target spreadsheet sheet tabs...`);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets || [];

  const requests: any[] = [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  // Find sheet ID for "Bid-Management", "Bidder-Numbers", and "Auction-Items"
  const bidMgmtSheet = existingSheets.find(s => s.properties?.title === "Bid-Management");
  const bidderNumSheet = existingSheets.find(s => s.properties?.title === "Bidder-Numbers");
  const auctionItemsSheet = existingSheets.find(s => s.properties?.title === "Auction-Items");

  // Step 3: Archive and Backup existing sheets if present
  if (bidMgmtSheet) {
    const backupTitle = `Bid-Management (Backup ${timestamp})`;
    console.log(`[Sync Step 3] Staging archiving of Bid-Management to: "${backupTitle}"...`);
    requests.push({
      updateSheetProperties: {
         properties: {
           sheetId: bidMgmtSheet.properties?.sheetId,
           title: backupTitle
         },
         fields: "title"
      }
    });
  }

  if (bidderNumSheet) {
    const backupTitle = `Bidder-Numbers (Backup ${timestamp})`;
    console.log(`[Sync Step 3] Staging archiving of Bidder-Numbers to: "${backupTitle}"...`);
    requests.push({
      updateSheetProperties: {
         properties: {
           sheetId: bidderNumSheet.properties?.sheetId,
           title: backupTitle
         },
         fields: "title"
      }
    });
  }

  if (auctionItemsSheet) {
    const backupTitle = `Auction-Items (Backup ${timestamp})`;
    console.log(`[Sync Step 3] Staging archiving of Auction-Items to: "${backupTitle}"...`);
    requests.push({
      updateSheetProperties: {
         properties: {
           sheetId: auctionItemsSheet.properties?.sheetId,
           title: backupTitle
         },
         fields: "title"
      }
    });
  }

  // Create clean sheet placeholders
  console.log(`[Sync Step 4] Appending fresh "Bidder-Numbers", "Bid-Management", and "Auction-Items" sheets...`);
  requests.push({
    addSheet: {
      properties: {
        title: "Bidder-Numbers"
      }
    }
  });
  requests.push({
    addSheet: {
      properties: {
        title: "Bid-Management"
      }
    }
  });
  requests.push({
    addSheet: {
      properties: {
        title: "Auction-Items"
      }
    }
  });

  // Run the batch update
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests }
  });

  // Fetch updated sheet IDs
  console.log(`[Sync] Retrieve new sheet IDs after creation...`);
  const updatedMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const updatedSheets = updatedMeta.data.sheets || [];
  
  const newBidderNumSheet = updatedSheets.find(s => s.properties?.title === "Bidder-Numbers");
  const newBidMgmtSheet = updatedSheets.find(s => s.properties?.title === "Bid-Management");
  const newAuctionItemsSheet = updatedSheets.find(s => s.properties?.title === "Auction-Items");

  if (!newBidderNumSheet || !newBidMgmtSheet || !newAuctionItemsSheet) {
    throw new Error("Sheet creation verification failed.");
  }

  const bnSheetId = newBidderNumSheet.properties?.sheetId;
  const bmSheetId = newBidMgmtSheet.properties?.sheetId;
  const aiSheetId = newAuctionItemsSheet.properties?.sheetId;

  // Step 4: Loading external ticket lists
  console.log(`[Sync Step 5] Extracting external ticket registrants and staff check-ins from sheet ID: ${auctionTicketSheetsID}...`);
  let ticketsRows: any[][] = [];
  let staffRows: any[][] = [];
  let sponsorRows: any[][] = [];
  
  try {
    const tRes = await sheets.spreadsheets.values.get({ spreadsheetId: auctionTicketSheetsID, range: "tickets!A:S" });
    ticketsRows = tRes.data.values || [];
  } catch (e) {
    console.warn("[Sync warnings] 'tickets' tab download bypassed or missing:", e);
  }
  try {
    const sRes = await sheets.spreadsheets.values.get({ spreadsheetId: auctionTicketSheetsID, range: "staff tickets!A:C" });
    staffRows = sRes.data.values || [];
  } catch (e) {
    console.warn("[Sync warnings] 'staff tickets' tab download bypassed or missing:", e);
  }
  try {
    const spRes = await sheets.spreadsheets.values.get({ spreadsheetId: auctionTicketSheetsID, range: "sponsor tickets!A:C" });
    sponsorRows = spRes.data.values || [];
  } catch (e) {
    console.warn("[Sync warnings] 'sponsor tickets' tab download bypassed or missing:", e);
  }

  // Parse and build bidders
  const collectedBidders: [string, string, string][] = [];

  // Parse staff: Row pattern [First, Last, Email]
  for (let i = 1; i < staffRows.length; i++) {
    const row = staffRows[i];
    if (row && (row[0] || row[1])) {
      collectedBidders.push([
        String(row[0] || "").trim(),
        String(row[1] || "").trim(),
        String(row[2] || "").trim()
      ]);
    }
  }

  // Parse primary ticket bidders
  for (let i = 1; i < ticketsRows.length; i++) {
    const row = ticketsRows[i];
    if (row && (row[0] || row[1])) {
      collectedBidders.push([
        String(row[0] || "").trim(),
        String(row[1] || "").trim(),
        String(row[2] || "").trim()
      ]);
    }
  }

  // Parse guest tickets
  const collectGuestInfo = (firstCol: number, lastCol: number, emailCol: number, ownBidderCol: number) => {
    for (let i = 1; i < ticketsRows.length; i++) {
      const row = ticketsRows[i];
      if (row && row.length > Math.max(firstCol, lastCol, emailCol, ownBidderCol, 6)) {
        const hasGuestMarker = String(row[6] || "").trim() !== "";
        const guestFirst = String(row[firstCol] || "").trim();
        if (hasGuestMarker && guestFirst !== "") {
          const wantsOwn = String(row[ownBidderCol] || "").trim().toLowerCase();
          if (wantsOwn === "yes") {
            collectedBidders.push([
              guestFirst,
              String(row[lastCol] || "").trim(),
              String(row[emailCol] || "").trim()
            ]);
          }
        }
      }
    }
  };

  collectGuestInfo(7, 8, 9, 10);
  collectGuestInfo(11, 12, 13, 14);
  collectGuestInfo(15, 16, 17, 18);

  // Parse sponsor tickets
  for (let i = 1; i < sponsorRows.length; i++) {
    const row = sponsorRows[i];
    if (row && (row[0] || row[1])) {
       collectedBidders.push([
         String(row[0] || "").trim(),
         String(row[1] || "").trim(),
         String(row[2] || "").trim()
       ]);
    }
  }

  // Filter out any blank or duplicate-looking rows
  const formatName = (str: string) => {
    const cleaned = str.trim();
    if (!cleaned) return "";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  };

  const finalBidders: any[][] = [];
  const seenKey = new Set<string>();

  collectedBidders.forEach((b) => {
    const first = formatName(b[0]);
    const last = formatName(b[1]);
    const email = b[2].toLowerCase().trim();
    const hash = `${first}|${last}|${email}`;
    if (!seenKey.has(hash)) {
      seenKey.add(hash);
      const id = 101 + finalBidders.length;
      finalBidders.push([
        id,
        first,
        last,
        email,
        false,
        false,
        false,
        false,
        "",
        "",
        ""
      ]);
    }
  });

  console.log(`[Sync] Gained registry index: ${finalBidders.length} unique ticketed/sponsor bidders.`);

  // Write "Bidder-Numbers" rows
  const bidderNumbersHeader = [
    "ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid", "Payment Method", "Invoice URL", "Invoiced Amount"
  ];
  const bidderNumbersValues = [
    bidderNumbersHeader,
    ...finalBidders
  ];

  console.log(`[Sync] Writing content values to Bidder-Numbers...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Bidder-Numbers!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: bidderNumbersValues }
  });

  // Step 5: Format Checkboxes & header freezing on Bidder-Numbers
  console.log(`[Sync] Formatting checkboxes and freezing header row on Bidder-Numbers...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId: bnSheetId,
              startRowIndex: 1,
              endRowIndex: 1 + finalBidders.length,
              startColumnIndex: 4,
              endColumnIndex: 8
            },
            rule: {
              condition: {
                type: "BOOLEAN"
              },
              showCustomUi: true
            }
          }
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: bnSheetId,
              gridProperties: {
                frozenRowCount: 1
              }
            },
            fields: "gridProperties.frozenRowCount"
          }
        }
      ]
    }
  });

  // Step 6: Build Column Matrix on Bid-Management
  console.log(`[Sync] Populating core Column Matrix on Bid-Management table...`);
  const numBidders = finalBidders.length;
  const totalCols = numBidders * 2;
  const bmRow1: any[] = [];
  const bmRow2: any[] = [];
  const bmRow3: any[] = [];

  for (let i = 0; i < numBidders; i++) {
    const bidder = finalBidders[i];
    const id = bidder[0];
    const first = bidder[1];
    const last = bidder[2];
    bmRow1.push(id, "");
    bmRow2.push(first, last);
    bmRow3.push("Item #:", "Price:");
  }

  // Pre-fill columns to have a tidy grid layout height 25
  const bmGridValues: any[][] = [bmRow1, bmRow2, bmRow3];
  for (let r = 4; r <= 25; r++) {
    bmGridValues.push(Array(totalCols).fill(""));
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Bid-Management!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: bmGridValues }
  });

  // Align, Merge headers, Freeze Rows, and Apply custom banding colors
  console.log(`[Sync] Setting cell merges, alignment filters, freezing 3 rows, and styling bands on Bid-Management...`);
  
  const bmFormattingRequests: any[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: bmSheetId,
          gridProperties: {
            frozenRowCount: 3
          }
        },
        fields: "gridProperties.frozenRowCount"
      }
    }
  ];

  // Merge headings (A1 to B1, C1 to D1, etc.)
  for (let i = 0; i < numBidders; i++) {
    bmFormattingRequests.push({
      mergeCells: {
        range: {
          sheetId: bmSheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 2 * i,
          endColumnIndex: 2 * i + 2
        },
        mergeType: "MERGE_ALL"
      }
    });

    bmFormattingRequests.push({
      repeatCell: {
        range: {
          sheetId: bmSheetId,
          startRowIndex: 0,
          endRowIndex: 3,
          startColumnIndex: 2 * i,
          endColumnIndex: 2 * i + 2
        },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
        fields: "userEnteredFormat.horizontalAlignment"
      }
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: bmFormattingRequests }
  });

  // Step 7: Load and merge Auction-Items catalog
  console.log(`[Sync Step 7] Copying master Auction Catalog items...`);
  let importRows: any[][] = [];
  if (auctionImportSheetID) {
    console.log(`[Sync Step 7] Copying master Auction Catalog items from ${auctionImportSheetID}...`);
    try {
      const impSpread = await sheets.spreadsheets.get({ spreadsheetId: auctionImportSheetID });
      const sheetsList = impSpread.data.sheets || [];
      const targetSheet = sheetsList.find(s => s.properties?.title === "Auction-Items") || sheetsList[0];
      const targetSheetName = targetSheet?.properties?.title || "";
      if (targetSheetName) {
        console.log(`[Sync Step 7] Reading sheet "${targetSheetName}" from master catalog...`);
        const impData = await sheets.spreadsheets.values.get({
          spreadsheetId: auctionImportSheetID,
          range: `${targetSheetName}!A:Z`
        });
        importRows = impData.data.values || [];
      }
    } catch (e) {
      console.error("[Sync Item Catalog] Failed to retrieve external master catalog details:", e);
    }
  }

  const mappedCatalog: any[][] = [];
  if (importRows.length > 0) {
    const headerRow = importRows[0];
    const headerLower = headerRow.map(h => String(h || "").toLowerCase().trim());
    
    // Support multiple variations for ID, Item Name, and Type
    const itemIdCol = headerLower.findIndex(h => 
      h === "id" || 
      h.includes("item id") || 
      h.includes("itemid") || 
      h.includes("item number") || 
      h.includes("auction item id") ||
      h.includes("auctionitemid") ||
      h === "number"
    );
    const itemNameCol = headerLower.findIndex(h => 
      h === "item name" || 
      h.includes("item name") || 
      h.includes("itemname") || 
      h === "name" || 
      h === "item"
    );
    const typeCol = headerLower.findIndex(h => 
      h === "type" || 
      h === "item type" || 
      h.includes("item type") || 
      h.includes("itemtype") || 
      h === "category" || 
      h.includes("category")
    );
    const statusCol = headerLower.findIndex(h => 
      h === "status" || 
      h.includes("status")
    );

    console.log(`[Sync Item Catalog Map] Columns detected: itemIdCol=${itemIdCol}, itemNameCol=${itemNameCol}, typeCol=${typeCol}, statusCol=${statusCol}`);

    for (let j = 1; j < importRows.length; j++) {
      const row = importRows[j];
      if (row && row.length > 0) {
        const itemId = itemIdCol !== -1 && row[itemIdCol] !== undefined ? String(row[itemIdCol]).trim() : "";
        const itemName = itemNameCol !== -1 && row[itemNameCol] !== undefined ? String(row[itemNameCol]).trim() : "";
        const itemType = typeCol !== -1 && row[typeCol] !== undefined ? String(row[typeCol]).trim() : "";
        const itemStatus = statusCol !== -1 && row[statusCol] !== undefined ? String(row[statusCol]).trim() : "";
        
        if (itemId && itemName) {
          // Verify status filter is Active
          const isStatusActive = statusCol !== -1 && itemStatus ? (itemStatus.toLowerCase() === "active") : true;
          if (isStatusActive) {
            mappedCatalog.push([parseFloat(itemId) || itemId, itemName, itemType]);
          }
        }
      }
    }
  }

  // Standard items to append afterwards
  const standardItems = [
    [1401, 'A Night with the ORNS Staff', ''],
    [1501, 'One Raffle Ticket for a $500 Amazon Gift Card', ''],
    [1502, 'Five Raffle Tickets for a $500 Amazon Gift Card', ''],
    [1503, 'Ten Raffle Tickets for a $500 Amazon Gift Card', ''],
    [1504, 'One 50/50 Raffle Ticket $20', ''],
    [1601, 'Open Appeal for $500', ''],
    [1602, 'Open Appeal for $250', ''],
    [1603, 'Open Appeal for $100', ''],
    [1604, 'Open Appeal for $50', ''],
    [1605, 'Open Appeal for $25', ''],
    [1606, 'Auction Tickets', '']
  ];

  const localItemsValues = [
    ["ID", "Item Name", "Type"],
    ...mappedCatalog,
    ...standardItems
  ];

  console.log(`[Sync] Populating Auction-Items sheet...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Auction-Items!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: localItemsValues }
  });

  // Freezing row = 1
  if (aiSheetId) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: aiSheetId,
                gridProperties: {
                  frozenRowCount: 1
                }
              },
              fields: "gridProperties.frozenRowCount"
            }
          }
        ]
      }
    });
  }

  console.log(`[Sync] --- SYNC TRANSITION WORKFLOW SUCCESSFULLY COMPLETED ---`);
  return { success: true };
}
