import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../utils/auth';
import { checkIdempotency, saveIdempotency } from '../utils/idempotency';
import { executeGoogleSheetsTransaction, SheetOp } from '../services/sheetsService';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';

export default function createBidRouter() {
  const router = Router();

  // Record winning bid with follow-up logic
  router.post("/auction/record-winning-bid", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { 
      bidderId, 
      itemId, 
      price, 
      spreadsheetId, 
      bidManagementSheet, 
      bidderNumbersSheet,
      idempotencyKey 
    } = req.body;

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // 1. Get Bidder Info (to check if already checked out)
      const bidderSearch = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bidderNumbersSheet}'!A:G`,
      });
      const biddersRows = bidderSearch.data.values || [];
      const bidderRow = biddersRows.find((row: any) => row[0]?.toString() === bidderId);
      
      if (!bidderRow) {
        throw new Error(`Bidder ${bidderId} not found.`);
      }

      const isCheckedOut = bidderRow[6] === true || bidderRow[6] === "TRUE";

      // 2. Add Bid to Bid-Management Sheet
      const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bidManagementSheet}'!1:300`,
      });
      const values = dataRes.data.values || [];
      if (values.length === 0) throw new Error("Bid sheet is empty");

      const header = values[0];
      let colIndex = -1;
      for (let j = 0; j < header.length; j += 2) {
        if (header[j]?.toString() === bidderId) {
          colIndex = j;
          break;
        }
      }
      if (colIndex === -1) throw new Error("Bidder column not found in Bid Management sheet");

      let rowIndex = -1;
      for (let i = 3; i < values.length; i++) {
        if (!values[i] || !values[i][colIndex]) {
          rowIndex = i + 1;
          break;
        }
      }
      if (rowIndex === -1) rowIndex = values.length + 1;
      if (rowIndex < 4) rowIndex = 4;

      const getColumnLetter = (index: number): string => {
        let letter = "";
        while (index >= 0) {
          letter = String.fromCharCode((index % 26) + 65) + letter;
          index = Math.floor(index / 26) - 1;
        }
        return letter;
      };

      const colLetter = getColumnLetter(colIndex);
      const nextColLetter = getColumnLetter(colIndex + 1);

      const operations: SheetOp[] = [];

      // Operation 1: Write the bid
      operations.push({
        type: 'UPDATE',
        spreadsheetId,
        range: `${bidManagementSheet}!${colLetter}${rowIndex}:${nextColLetter}${rowIndex}`,
        newValues: [[itemId, price]]
      });

      // Operation 2: Follow-Up logic if already checked out
      let followUpAdded = false;
      if (isCheckedOut) {
        // 3. Ensure Follow-Up sheet exists (optional but helpful)
        const metadata = await sheets.spreadsheets.get({ spreadsheetId });
        const followUpSheet = metadata.data.sheets?.find(s => s.properties?.title === "Follow-Up");
        
        if (!followUpSheet) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{
                addSheet: {
                  properties: { title: "Follow-Up" }
                }
              }]
            }
          });
          // Add header if new
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: "Follow-Up!A1:C1",
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [["Bidder ID", "Item ID", "Amount"]]
            }
          });
        }

        operations.push({
          type: 'APPEND',
          spreadsheetId,
          range: `Follow-Up!A:C`,
          newValues: [[bidderId, itemId, price]]
        });
        followUpAdded = true;
      }

      await executeGoogleSheetsTransaction(sheets, operations);
      clearCacheForSpreadsheet(spreadsheetId);

      const result = { success: true, followUpAdded };
      saveIdempotency(idempotencyKey, result);
      res.json(result);

    } catch (error: any) {
      console.error("[Transaction Error] record-winning-bid:", error);
      next(error);
    }
  });

  // transactional checkout
  router.post("/auction/checkout-mark-paid", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { 
      bidderId, 
      spreadsheetId, 
      ticketsSpreadsheetId, 
      bidderNumbersSheet, 
      attendeeInfo,
      scriptId: bodyScriptId,
      paymentMethod,
      amount,
      idempotencyKey 
    } = req.body;

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    if (!spreadsheetId || !bidderId || !bidderNumbersSheet) {
      return res.status(400).json({ error: "Missing required parameters for checkout" });
    }

    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    if (!scriptId) {
      return res.status(500).json({
        error: "SCRIPT_ID_BID_MANAGEMENT is not configured. Please add it to the Settings tab in the app."
      });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      
      // Call Apps Script bridge function apiRecordPayment
      const script = google.script({ version: "v1", auth: client });
      console.log(`[Script API] Calling bridge function 'apiRecordPayment' for Bidder ${bidderId}`);
      
      const parsedAmount = typeof amount === "string" ? parseFloat(amount.replace(/[^0-9.]/g, "")) : Number(amount);

      const scriptResponse = await script.scripts.run({
        scriptId: scriptId,
        requestBody: {
          function: "apiRecordPayment",
          parameters: [String(bidderId), paymentMethod || "CASH"],
          devMode: true,
        },
      });
      
      if (scriptResponse.data.error) {
        const eData = scriptResponse.data.error.details?.[0] as any;
        throw new Error(eData?.errorMessage || "Unknown Apps Script execution error");
      }

      const { response } = scriptResponse.data;
      if (response?.result && typeof response.result === 'object') {
        const resultObj = response.result as any;
        if (resultObj.success === false) {
          throw new Error(resultObj.error || "Failed to record payment in Google Apps Script");
        }
      }

      // Optional: Write 2: Auction Tickets Sheet (if applicable)
      let attendeeUpdated = false;
      if (ticketsSpreadsheetId && attendeeInfo && attendeeInfo.sheet && attendeeInfo.rowIndex) {
        const sheets = google.sheets({ version: "v4", auth: client });
        const operations: SheetOp[] = [];
        operations.push({
          type: 'UPDATE',
          spreadsheetId: ticketsSpreadsheetId,
          range: `${attendeeInfo.sheet}!U${attendeeInfo.rowIndex}`,
          newValues: [["Paid"]]
        });
        await executeGoogleSheetsTransaction(sheets, operations);
        if (ticketsSpreadsheetId) {
          clearCacheForSpreadsheet(ticketsSpreadsheetId);
        }
        attendeeUpdated = true;
      }

      clearCacheForSpreadsheet(spreadsheetId);

      const result = { success: true, attendeeUpdated };
      saveIdempotency(idempotencyKey, result);
      res.json(result);
    } catch (error: any) {
      console.error("[Transaction Error] checkout-mark-paid:", error);
      next(error);
    }
  });

  router.post("/auction/close-and-cleanup", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId, bidderNumbersSheet, bidManagementSheet } = req.body;

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // 1. Close Auction
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "'Auction-Status'!A2",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[false]] }
      });

      // 2. Read Bidders
      const biddersRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bidderNumbersSheet}'!A:H`
      });
      const bidderRows = biddersRes.data.values || [];

      // 3. Read Winners (to find out who won anything)
      const bidRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bidManagementSheet}'!A:ZZ`
      });
      const bidRows = bidRes.data.values || [];
      
      const winnersSet = new Set<string>();
      if (bidRows.length > 0) {
        const header = bidRows[0];
        for (let j = 0; j < header.length; j += 2) {
          const bidderId = header[j];
          if (!bidderId) continue;
          
          let hasWins = false;
          for (let i = 3; i < bidRows.length; i++) {
            if (bidRows[i] && bidRows[i][j]) {
              hasWins = true;
              break;
            }
          }
          if (hasWins) winnersSet.add(bidderId.toString());
        }
      }

      // 4. Update Bidders
      const updates: any[] = [];
      for (let i = 1; i < bidderRows.length; i++) {
        const id = bidderRows[i][0]?.toString();
        const checkedIn = bidderRows[i][4] === "TRUE" || bidderRows[i][4] === "true";
        const checkedOut = bidderRows[i][6] === "TRUE" || bidderRows[i][6] === "true";
        
        if (id && checkedIn && !checkedOut && !winnersSet.has(id)) {
          updates.push({
            range: `'${bidderNumbersSheet}'!G${i + 1}:H${i + 1}`,
            values: [[true, true]] 
          });
        }
      }

      if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            data: updates,
            valueInputOption: "USER_ENTERED"
          }
        });
      }

      clearCacheForSpreadsheet(spreadsheetId);

      res.json({ success: true, count: updates.length });
    } catch (error: any) {
      console.error("[Auction Close Error]:", error);
      next(error);
    }
  });

  // Update walk-in to be transactional across sheets
  router.post("/bidders/walk-in", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { 
      firstName, 
      lastName, 
      email, 
      spreadsheetId, 
      ticketsSpreadsheetId,
      ticketPrice,
      bidderNumbersSheet,
      bidManagementSheet,
      idempotencyKey 
    } = req.body;

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    if (!bidderNumbersSheet || !bidManagementSheet) {
       return res.status(400).json({ error: "Missing required sheet names for walk-in." });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // Step 0: Pre-verify Tickets Sheet if provided (Staging to prevent mismatched states)
      let targetSheetName = "tickets";
      if (ticketsSpreadsheetId) {
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: ticketsSpreadsheetId });
        const sheet = spreadsheet.data.sheets?.find(s => 
          s.properties?.title?.toLowerCase() === "tickets"
        );
        targetSheetName = sheet?.properties?.title || "tickets";
        
        // Verify we can access/append to this range
        await sheets.spreadsheets.values.get({
          spreadsheetId: ticketsSpreadsheetId,
          range: `'${targetSheetName}'!A1`, 
        });
      }

      console.log("[Walk-In] Fetching metadata for Spreadsheet IDs to perform native Google Sheet integration...");

      // NATIVE REPLACEMENT FOR Apps Script "apiCreateWalkInTicket"
      // Step A: Fetch Sheet IDs for insertDimension
      const metadata = await sheets.spreadsheets.get({ spreadsheetId });
      const bdSheet = metadata.data.sheets?.find(s => s.properties?.title === bidderNumbersSheet);
      const bmSheet = metadata.data.sheets?.find(s => s.properties?.title === bidManagementSheet);
      
      if (!bdSheet || !bmSheet) {
        throw new Error("[Walk-In] Could not find Bidder-Numbers or Bid-Management sheet IDs. Please verify settings.");
      }

      console.log("[Walk-In] Fetching current bidders to calculate new bidder ID...");
      // Step B: Calculate new Bidder ID
      const bdData = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bidderNumbersSheet}'!A:A`
      });
      const bdRows = bdData.data.values || [];
      const formatName = (str: string) => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
      const formattedFirst = formatName(firstName);
      const formattedLastName = formatName(lastName);
      const formattedEmail = (email || "").trim();

      const maxId = bdRows.slice(1).reduce((max: number, row: any) => Math.max(max, parseInt(row[0]) || 0), 100);
      const newId = maxId + 1;
      
      console.log(`[Walk-In] New Bidder ID calculated: ${newId}. Attempting to create bid management columns...`);

      // Step C: Find last column in Bid-Management
      const bmData = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bidManagementSheet}'!1:5`
      });
      
      let maxCols = 0;
      (bmData.data.values || []).forEach((row: any[]) => {
        maxCols = Math.max(maxCols, row.length);
      });
      
      let lastColIndex = maxCols;
      
      // Ensure we start on an even column boundary (0-indexed, if 2 cols per bidder)
      if (lastColIndex % 2 !== 0) {
        lastColIndex += 1;
      }
      
      const totalCols = bmSheet.properties?.gridProperties?.columnCount || 0;
      if (totalCols <= lastColIndex + 2) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                appendDimension: {
                  sheetId: bmSheet.properties?.sheetId,
                  dimension: "COLUMNS",
                  length: Math.max(2, (lastColIndex + 2) - totalCols + 2)
                }
              }
            ]
          }
        });
        console.log(`[Walk-In] Successfully appended columns to Bid-Management.`);
      }

      // Step D: Write new data to both sheets
      const getColumnLetter = (index: number): string => {
        let letter = "";
        while (index >= 0) {
          letter = String.fromCharCode((index % 26) + 65) + letter;
          index = Math.floor(index / 26) - 1;
        }
        return letter;
      };

      const newColLetter = getColumnLetter(lastColIndex);
      const nextColLetter = getColumnLetter(lastColIndex + 1);
      
      const operations: any[] = [];
      
      // Bidder-Numbers append
      operations.push({
        type: 'APPEND',
        spreadsheetId,
        range: `${bidderNumbersSheet}!A:H`,
        newValues: [[newId, formattedFirst, formattedLastName, formattedEmail, true, false, false, false]]
      });

      // Bid-Management header formatting
      operations.push({
        type: 'UPDATE',
        spreadsheetId,
        range: `${bidManagementSheet}!${newColLetter}1:${nextColLetter}4`,
        newValues: [
          [newId, ""],
          [formattedFirst, formattedLastName],
          ['Item #:', 'Price:'],
          [1606, ticketPrice || 35]
        ]
      });

      console.log(`[Walk-In] Executing Google Sheets transaction to apply Walk-in data...`);
      await executeGoogleSheetsTransaction(sheets, operations);

      console.log(`[Walk-In] Applying rich formatting to Bid-Management...`);
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              mergeCells: {
                range: {
                  sheetId: bmSheet.properties?.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: lastColIndex,
                  endColumnIndex: lastColIndex + 2
                },
                mergeType: "MERGE_ALL"
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId: bmSheet.properties?.sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: lastColIndex,
                  endColumnIndex: lastColIndex + 2
                },
                cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
                fields: "userEnteredFormat.horizontalAlignment"
              }
            },
            {
              repeatCell: {
                range: {
                  sheetId: bmSheet.properties?.sheetId,
                  startRowIndex: 1,
                  endRowIndex: 2,
                  startColumnIndex: lastColIndex,
                  endColumnIndex: lastColIndex + 2
                },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: "userEnteredFormat.textFormat.bold"
              }
            }
          ]
        }
      });
      console.log(`[Walk-In] Successfully completed Bid-Management column formatting.`);

      const scriptResult = {
        success: true,
        bidder: { id: newId, firstName: formattedFirst, lastName: formattedLastName }
      };

      // Step 2: Write to Tickets Spreadsheet if provided
      let ticketAppended = false;
      let appendError = null;
      if (ticketsSpreadsheetId) {
        try {
          const rowValue = new Array(22).fill("");
          rowValue[0] = firstName;
          rowValue[1] = lastName;
          rowValue[2] = email || "";
          rowValue[4] = "1";
          rowValue[5] = "FALSE";
          rowValue[19] = "Auction Checkout"; 
          rowValue[20] = "Pending";
          rowValue[21] = `$${ticketPrice || 35}`; 
          
          await executeGoogleSheetsTransaction(sheets, [{
            type: 'APPEND',
            spreadsheetId: ticketsSpreadsheetId,
            range: `${targetSheetName}!A:V`,
            newValues: [rowValue]
          }]);
          ticketAppended = true;
        } catch (err: any) {
          console.warn("[Transaction] Walk-in ticket append failed:", err.message);
          appendError = err.message;
        }
      }

      const result = { 
        success: scriptResult?.success, 
        bidder: scriptResult?.bidder, 
        ticketAppended, 
        appendError: appendError || null 
      };
      saveIdempotency(idempotencyKey, result);
      res.json(result);

    } catch (error: any) {
      console.error("[Transaction Error] walk-in:", error);
      next(error);
    }
  });

  // Transactional Check-in with optional Bid (e.g. for unpaid tickets)
  router.post("/auction/check-in-with-bid", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { 
      bidderId, 
      spreadsheetId, 
      bidManagementSheet, 
      bidderNumbersSheet, 
      bidValue,
      idempotencyKey 
    } = req.body;

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      // 1. Add Bid to Bid-Management Sheet
      const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bidManagementSheet}'!1:300`,
      });
      const values = dataRes.data.values || [];
      if (values.length === 0) throw new Error("Bid sheet is empty");

      const header = values[0];
      let colIndex = -1;
      for (let j = 0; j < header.length; j += 2) {
        if (header[j]?.toString() === bidderId) {
          colIndex = j;
          break;
        }
      }
      if (colIndex === -1) throw new Error("Bidder column not found");

      let rowIndex = -1;
      for (let i = 3; i < values.length; i++) {
        if (!values[i] || !values[i][colIndex]) {
          rowIndex = i + 1;
          break;
        }
      }
      if (rowIndex === -1) rowIndex = values.length + 1;
      if (rowIndex < 4) rowIndex = 4;

      const getColumnLetter = (index: number): string => {
        let letter = "";
        while (index >= 0) {
          letter = String.fromCharCode((index % 26) + 65) + letter;
          index = Math.floor(index / 26) - 1;
        }
        return letter;
      };

      const colLetter = getColumnLetter(colIndex);
      const nextColLetter = getColumnLetter(colIndex + 1);

      const operations: SheetOp[] = [];

      // Write Bid
      operations.push({
        type: 'UPDATE',
        spreadsheetId,
        range: `'${bidManagementSheet}'!${colLetter}${rowIndex}:${nextColLetter}${rowIndex}`,
        newValues: [["1606", bidValue]]
      });

      // 2. Mark Checked In in Bidder Numbers Sheet
      const bidderSearch = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${bidderNumbersSheet}'!A:A`,
      });
      const biddersRows = bidderSearch.data.values || [];
      const bidderRowIndex = biddersRows.findIndex((row: any) => row[0]?.toString() === bidderId) + 1;

      if (bidderRowIndex > 1) {
        operations.push({
          type: 'UPDATE',
          spreadsheetId,
          range: `'${bidderNumbersSheet}'!E${bidderRowIndex}`,
          newValues: [[true]]
        });
      }

      await executeGoogleSheetsTransaction(sheets, operations);

      const result = { success: true, bidAdded: true, checkedIn: true };
      saveIdempotency(idempotencyKey, result);
      res.json(result);

    } catch (error: any) {
      console.error("[Transaction Error] check-in-with-bid:", error);
      next(error);
    }
  });

  return router;
}
