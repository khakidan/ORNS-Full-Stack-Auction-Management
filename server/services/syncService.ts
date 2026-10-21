import { google } from "googleapis";
import { BIDDER_NUMBERS_HEADERS } from "../utils/bidderNumbersHeaders";

/** Reads the staff/tickets/sponsor rows from the external Auction Tickets spreadsheet. */
async function fetchTicketSheetRows(sheets: any, auctionTicketSheetsID: string): Promise<{ ticketsRows: any[][]; staffRows: any[][]; sponsorRows: any[][] }> {
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

  return { ticketsRows, staffRows, sponsorRows };
}

/**
 * Pure transform: staff/tickets/sponsor rows -> deduped, sequentially
 * numbered Bidder-Numbers rows (ID, First, Last, Email, 4 blank booleans,
 * 3 blank strings), starting at 101. The iteration order is deliberate and
 * load-bearing - staff, then every ticket-buying primary, then every
 * guest-1 across all ticket rows, then every guest-2, then every guest-3,
 * then sponsors - and is shared by performSheetSync (the full "Set Up Bid
 * Management App" rebuild) and ensureBidderNumbersSheet (the narrower
 * "build it if missing" path bidder-label generation uses so labels can be
 * printed before Bid-Management is ever set up - see CHANGELOG.md). There
 * is exactly one implementation of this ordering here, never two copies
 * that could quietly drift apart.
 */
export function computeBidderNumbersRows(staffRows: any[][], ticketsRows: any[][], sponsorRows: any[][]): any[][] {
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
      if (row && row.length > Math.max(firstCol, lastCol, emailCol, ownBidderCol)) {
        const guestFirst = String(row[firstCol] || "").trim();
        // A guest is real whenever their own name is present - matches
        // src/lib/attendeeParsing.ts's own inclusion check, which never
        // reads column G (row[6]) at all. This used to also require
        // row[6] to be non-blank (a separate "guest marker" checkbox
        // distinct from the guest's own data), which silently dropped
        // any guest whose row simply never had that checkbox ticked -
        // even one with a real name/email who explicitly opted in below
        // - from ever being added to Bidder-Numbers, so their labels
        // were never generated. Guest inclusion is real name + opt-in
        // only now, the same two facts the app's own attendee table
        // already treats as authoritative.
        if (guestFirst !== "") {
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

  return finalBidders;
}

/** Writes computed Bidder-Numbers rows into the given sheet, then applies checkbox validation (Checked In/Proxy/Checked Out/Paid) and freezes the header row. */
async function writeBidderNumbersSheet(sheets: any, spreadsheetId: string, bnSheetId: number, finalBidders: any[][]): Promise<void> {
  const bidderNumbersHeader = BIDDER_NUMBERS_HEADERS;
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
}

/**
 * Builds the "Bidder-Numbers" sheet in the Bid-Management spreadsheet if
 * (and only if) it doesn't already hold real data - used by bidder-label
 * generation so labels can be printed before "Set Up Bid Management App"
 * has ever been run (the real auction workflow: labels are printed 2-3
 * days out, Bid-Management setup is one of the last things done, day-of -
 * see CHANGELOG.md). Deliberately idempotent: if Bidder-Numbers already
 * has data - whether from an earlier "Create Labels" run or a real "Set
 * Up Bid Management App" sync - this is a no-op, so numbers already
 * printed on a physical label never silently change underneath someone.
 * Shares computeBidderNumbersRows/writeBidderNumbersSheet with
 * performSheetSync, so there is exactly one implementation of the
 * numbering algorithm, not a second copy that could drift from it.
 */
export async function ensureBidderNumbersSheet(client: any, spreadsheetId: string, auctionTicketSheetsID: string): Promise<{ created: boolean; count: number }> {
  const sheets = google.sheets({ version: "v4", auth: client });

  if (!auctionTicketSheetsID) {
    throw new Error("Missing the Auction Tickets spreadsheet ID - configure it in Settings before creating bidder labels.");
  }

  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bidder-Numbers!A2:A2" }).catch(() => ({ data: { values: [] } }));
  const alreadyPopulated = (existing.data.values || []).length > 0 && !!existing.data.values[0]?.[0];
  if (alreadyPopulated) {
    console.log("[Bidder Labels] Bidder-Numbers already has data - reusing it so already-printed numbers never change.");
    return { created: false, count: 0 };
  }

  console.log("[Bidder Labels] Bidder-Numbers is missing or empty - building it now so labels can be printed before Bid-Management setup.");
  const { ticketsRows, staffRows, sponsorRows } = await fetchTicketSheetRows(sheets, auctionTicketSheetsID);
  const finalBidders = computeBidderNumbersRows(staffRows, ticketsRows, sponsorRows);

  let meta = await sheets.spreadsheets.get({ spreadsheetId });
  let bnSheet = (meta.data.sheets || []).find((s: any) => s.properties?.title === "Bidder-Numbers");
  if (!bnSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "Bidder-Numbers" } } }] }
    });
    meta = await sheets.spreadsheets.get({ spreadsheetId });
    bnSheet = (meta.data.sheets || []).find((s: any) => s.properties?.title === "Bidder-Numbers");
  }
  const bnSheetId = bnSheet?.properties?.sheetId;
  if (bnSheetId === undefined) {
    throw new Error("Failed to create or find the Bidder-Numbers sheet.");
  }

  await writeBidderNumbersSheet(sheets, spreadsheetId, bnSheetId, finalBidders);
  console.log(`[Bidder Labels] Bidder-Numbers built with ${finalBidders.length} entries.`);
  return { created: true, count: finalBidders.length };
}

/**
 * Reads the Bid-Management spreadsheet's "Bidder-Numbers" sheet (the single
 * source of truth, guaranteed populated by `ensureBidderNumbersSheet` before
 * this is called) and returns a flat, number-sorted { name, number } list
 * for bidder-label generation.
 *
 * This replaces what used to be a second, independent lookup inside
 * `scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_BidderManager.gs`'s
 * `getAllBidders()` - that GAS class re-read the Auction Tickets
 * spreadsheet's staff/tickets/sponsor sheets and re-matched each person
 * against Bidder-Numbers by a normalized name/email key that its own code
 * comment admitted "must stay byte-for-byte identical" to this file's
 * formatting logic. Reading the already-built Bidder-Numbers rows directly
 * needs no matching at all - the ID and name are already sitting right next
 * to each other in the same row - so there is no second implementation left
 * to drift out of sync.
 */
export async function getBidderLabelList(client: any, spreadsheetId: string): Promise<{ name: string; number: string }[]> {
  const sheets = google.sheets({ version: "v4", auth: client });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Bidder-Numbers!A2:D" });
  const rows = res.data.values || [];

  return rows
    .filter((row: any[]) => row && row[0])
    .map((row: any[]) => ({
      name: `${row[1] || ""} ${row[2] || ""}`.trim(),
      number: String(row[0])
    }))
    .sort((a: { number: string }, b: { number: string }) => parseInt(a.number, 10) - parseInt(b.number, 10));
}

export async function performSheetSync(client: any, spreadsheetId: string, customAuctionTicketSheetsID?: string) {
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

  const auctionTicketSheetsID = customAuctionTicketSheetsID || settingsMap["auctionTicketSheetsID"];
  const ticketPriceVal = parseFloat(settingsMap["ticketPrice"] || "35") || 35;

  console.log("[Sync Config] Master Ticket sales file ID: " + auctionTicketSheetsID);
  console.log("[Sync Config] Walk-In standard ticket cost: $" + ticketPriceVal);

  if (!auctionTicketSheetsID) {
    throw new Error("Missing 'auctionTicketSheetsID' in settings. Please configure settings first.");
  }

  // Step 1.5: Refuse to re-sync once a walk-in bidder has already been
  // registered directly against Bid-Management (see bidderService.ts's
  // registerWalkInBidder, which appends a "Auction Checkout" payment-method
  // marker in column T of the 'tickets' sheet). A full sync rebuilds
  // Bidder-Numbers from scratch, which would reassign or duplicate that
  // person's bidder number relative to the ID already recorded against
  // their existing Bid-Management bids - exactly the kind of drift that
  // could let someone win an item under a number that isn't really theirs.
  console.log("[Sync Guard] Checking for already-registered walk-in bidders...");
  const walkInCheckRes = await sheets.spreadsheets.values.get({
    spreadsheetId: auctionTicketSheetsID,
    range: "'tickets'!A:T"
  }).catch(() => ({ data: { values: [] } }));
  const walkInCheckRows = walkInCheckRes.data.values || [];
  const walkInNames = walkInCheckRows.slice(1)
    .filter((row: any[]) => String(row?.[19] || "").trim() === "Auction Checkout")
    .map((row: any[]) => `${row[0] || ""} ${row[1] || ""}`.trim())
    .filter(Boolean);
  if (walkInNames.length > 0) {
    throw new Error(
      `Cannot re-sync: ${walkInNames.length} walk-in bidder(s) have already been registered directly (${walkInNames.join(", ")}). ` +
      `Re-running "Set Up Bid Management App" would rebuild Bidder-Numbers from scratch and could reassign or duplicate their ` +
      `bidder number, breaking bids already recorded against it. Only run sync before any walk-ins are registered.`
    );
  }

  // Step 2: Query sheet list of spreadsheet
  console.log("[Sync Step 2] Inspecting target spreadsheet sheet tabs...");
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = meta.data.sheets || [];

  const requests: any[] = [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "_" + pad(now.getHours()) + "-" + pad(now.getMinutes()) + "-" + pad(now.getSeconds());

  // Find sheet ID for "Bid-Management" and "Bidder-Numbers"
  const bidMgmtSheet = existingSheets.find(s => s.properties?.title === "Bid-Management");
  const bidderNumSheet = existingSheets.find(s => s.properties?.title === "Bidder-Numbers");

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

  // Create clean sheet placeholders
  console.log("[Sync Step 4] Appending fresh 'Bidder-Numbers' and 'Bid-Management' sheets...");
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

  if (!newBidderNumSheet || !newBidMgmtSheet) {
    throw new Error("Sheet creation verification failed.");
  }

  const bnSheetId = newBidderNumSheet.properties?.sheetId;
  const bmSheetId = newBidMgmtSheet.properties?.sheetId;

  // Step 4: Loading external ticket lists
  console.log("[Sync Step 5] Extracting external ticket registrants and staff check-ins from sheet ID: " + auctionTicketSheetsID + "...");
  const { ticketsRows, staffRows, sponsorRows } = await fetchTicketSheetRows(sheets, auctionTicketSheetsID);
  const finalBidders = computeBidderNumbersRows(staffRows, ticketsRows, sponsorRows);

  console.log("[Sync] Gained registry index: " + finalBidders.length + " unique ticketed/sponsor bidders.");

  await writeBidderNumbersSheet(sheets, spreadsheetId, bnSheetId, finalBidders);

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

  console.log("[Sync] --- SYNC TRANSITION WORKFLOW SUCCESSFULLY COMPLETED ---");
  return { success: true };
}
