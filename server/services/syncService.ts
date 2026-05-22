import { google } from "googleapis";

export async function performSheetSync(client: any, spreadsheetId: string, customAuctionImportSheetID?: string, customAuctionTicketSheetsID?: string) {
  const sheets = google.sheets({ version: "v4", auth: client });

  console.log("[Sync] --- STARTING INTEGRATED NODE.JS SHEET SYNC TRANSITION ---");
  console.log("[Sync] Spreadsheet target ID: " + spreadsheetId);

  // Step 1: Load Settings
  console.log("[Sync Step 1] Fetching settings list from _Settings sheet...");
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

  console.log("[Sync Config] Master Ticket sales file ID: " + auctionTicketSheetsID);
  console.log("[Sync Config] Master Catalog registry item file ID: " + auctionImportSheetID);
  console.log("[Sync Config] Walk-In standard ticket cost: $" + ticketPriceVal);

  if (!auctionTicketSheetsID) {
    throw new Error("Missing 'auctionTicketSheetsID' in settings. Please configure settings first.");
  }

  // Step 2: Query sheet list of spreadsheet
  console.log("[Sync Step 2] Inspecting target spreadsheet sheet tabs...");
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets || [];

  const requests: any[] = [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "_" + pad(now.getHours()) + "-" + pad(now.getMinutes()) + "-" + pad(now.getSeconds());

  // Find sheet ID for "Bid-Management", "Bidder-Numbers", and "Auction-Items"
  const bidMgmtSheet = existingSheets.find(s => s.properties?.title === "Bid-Management");
  const bidderNumSheet = existingSheets.find(s => s.properties?.title === "Bidder-Numbers");
  const auctionItemsSheet = existingSheets.find(s => s.properties?.title === "Auction-Items");

  // Step 3: Archive and Backup existing sheets if present
  if (bidMgmtSheet) {
    const backupTitle = "Bid-Management (Backup " + timestamp + ")";
    console.log("[Sync Step 3] Staging archiving of Bid-Management to: " + backupTitle + "...");
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
    const backupTitle = "Bidder-Numbers (Backup " + timestamp + ")";
    console.log("[Sync Step 3] Staging archiving of Bidder-Numbers to: " + backupTitle + "...");
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
    const backupTitle = "Auction-Items (Backup " + timestamp + ")";
    console.log("[Sync Step 3] Staging archiving of Auction-Items to: " + backupTitle + "...");
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
  console.log("[Sync Step 4] Appending fresh 'Bidder-Numbers', 'Bid-Management', and 'Auction-Items' sheets...");
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
  console.log("[Sync] Retrieve new sheet IDs after creation...");
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
  console.log("[Sync Step 5] Extracting external ticket registrants and staff check-ins from sheet ID: " + auctionTicketSheetsID + "...");
  let ticketsRows: any[][] = [];
  let staffRows: any[][] = [];
  let sponsorRows: any[][] = [];
  
  try {
    const tRes = await sheets.spreadsheets.values.get({ spreadsheetId: auctionTicketSheetsID, range: "'tickets'!A:S" });
    ticketsRows = tRes.data.values || [];
  } catch (e) {
    console.warn("[Sync warnings] 'tickets' tab download bypassed or missing:", e);
  }
  try {
    const sRes = await sheets.spreadsheets.values.get({ spreadsheetId: auctionTicketSheetsID, range: "'staff tickets'!A:C" });
    staffRows = sRes.data.values || [];
  } catch (e) {
    console.warn("[Sync warnings] 'staff tickets' tab download bypassed or missing:", e);
  }
  try {
    const spRes = await sheets.spreadsheets.values.get({ spreadsheetId: auctionTicketSheetsID, range: "'sponsor tickets'!A:C" });
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
    const hash = first + "|" + last + "|" + email;
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

  console.log("[Sync] Gained registry index: " + finalBidders.length + " unique ticketed/sponsor bidders.");

  // Write "Bidder-Numbers" rows
  const bidderNumbersHeader = [
    "ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid", "Payment Method", "Invoice URL", "Invoiced Amount"
  ];
  const bidderNumbersValues = [
    bidderNumbersHeader,
    ...finalBidders
  ];

  console.log("[Sync] Writing content values to Bidder-Numbers...");
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "Bidder-Numbers!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: bidderNumbersValues }
  });

  // Step 5: Format Checkboxes & header freezing on Bidder-Numbers
  console.log("[Sync] Formatting checkboxes and freezing header row on Bidder-Numbers...");
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
  console.log("[Sync] Populating core Column Matrix on Bid-Management table...");
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
  console.log("[Sync] Setting cell merges, alignment filters, freezing 3 rows, and styling bands on Bid-Management...");
  
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
  console.log("[Sync Step 7] Copying master Auction Catalog items...");
  let importRows: any[][] = [];
  if (auctionImportSheetID) {
    console.log("[Sync Step 7] Copying master Auction Catalog items from " + auctionImportSheetID + "...");
    try {
      const impSpread = await sheets.spreadsheets.get({ spreadsheetId: auctionImportSheetID });
      const sheetsList = impSpread.data.sheets || [];
      const targetSheet = sheetsList.find(s => s.properties?.title === "Auction-Items") || sheetsList[0];
      const targetSheetName = targetSheet?.properties?.title || "";
      if (targetSheetName) {
        console.log("[Sync Step 7] Reading sheet '" + targetSheetName + "'' from master catalog...");
        const impData = await sheets.spreadsheets.values.get({
          spreadsheetId: auctionImportSheetID,
          range: `'${targetSheetName}'!A:Z`
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
    let typeCol = headerLower.findIndex(h => 
      h === "type" || 
      h === "item type" || 
      h.includes("item type") || 
      h.includes("itemtype")
    );
    if (typeCol === -1) {
      typeCol = headerLower.findIndex(h => 
        h === "category" || 
        h.includes("category")
      );
    }
    const statusCol = headerLower.findIndex(h => 
      h === "status" || 
      h.includes("status")
    );

    console.log("[Sync Item Catalog Map] Columns detected: itemIdCol=" + itemIdCol + ", itemNameCol=" + itemNameCol + ", typeCol=" + typeCol + ", statusCol=" + statusCol);

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

  console.log("[Sync] Populating Auction-Items sheet...");
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

  console.log("[Sync] --- SYNC TRANSITION WORKFLOW SUCCESSFULLY COMPLETED ---");
  return { success: true };
}
