import { drive_v3, sheets_v4 } from "googleapis";

export interface SetupAuctionParams {
  ticketsSpreadsheetId: string;
  itemEntrySpreadsheetId: string;
  bidManagementSpreadsheetId: string;
}

export interface SetupAuctionResult {
  success: boolean;
  auctionYear: number;
  forPrintFolderId: string;
  bidderReceiptsFolderId: string;
}

/**
 * Orchestrates the full setup for a new auction year.
 * Handles folder creation, archiving, template copying, and spreadsheet cleanup.
 */
export async function setupNewAuction(
  drive: drive_v3.Drive,
  sheets: sheets_v4.Sheets,
  params: SetupAuctionParams,
  onLog: (msg: string) => void
): Promise<SetupAuctionResult> {
  const { 
    ticketsSpreadsheetId, 
    itemEntrySpreadsheetId, 
    bidManagementSpreadsheetId 
  } = params;

  const parentFolderId = process.env.DRIVE_PARENT_FOLDER_ID;
  const archivedFolderId = process.env.DRIVE_ARCHIVE_FOLDER_ID;

  if (!parentFolderId || !archivedFolderId) {
    throw new Error("DRIVE_PARENT_FOLDER_ID or DRIVE_ARCHIVE_FOLDER_ID is not configured.");
  }

  // 1. Calculate dates
  const today = new Date();
  let auctionYear = today.getFullYear();
  // getMonth() is 0-indexed: > 3 means May or later, so default to next year's auction
  if (today.getMonth() > 3) {
    auctionYear += 1;
  }
  const lastYear = auctionYear - 1;
  const maxArchiveYear = auctionYear - 2;
  const baseFolderName = `${auctionYear} Auction`;

  onLog(`Starting setup for auction year: ${auctionYear}`);

  // 2. Archive old folders && check for new folder existence
  onLog(`Scanning parent directory for existing folders...`);
  const folderRes = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name, parents)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  
  onLog(`Found ${folderRes.data.files?.length || 0} existing folders in parent directory.`);
  
  const folders = folderRes.data.files || [];
  let lastYearFolderId: string | undefined;
  
  for (const folder of folders) {
    if (folder.name === baseFolderName) {
      // Throw a specific error message that the controller can format
      throw new Error(`The '${baseFolderName}' folder already exists. Automation cancelled to prevent duplicates.`);
    }
    
    const match = folder.name?.match(/^(\d{4}) Auction$/);
    if (match) {
      const folderYear = parseInt(match[1], 10);
      if (folderYear === lastYear) {
        lastYearFolderId = folder.id!;
      }
      if (folderYear <= maxArchiveYear) {
        onLog(`Archiving old folder: ${folder.name}`);
        await drive.files.update({
          fileId: folder.id!,
          addParents: archivedFolderId,
          removeParents: parentFolderId,
          fields: 'id',
          supportsAllDrives: true
        });
      }
    }
  }
  
  // 3. Create new folder and subfolders
  onLog(`Creating new base folder: ${baseFolderName}`);
  const createFolder = async (name: string, parentId: string) => {
    const resp = await drive.files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
      fields: "id",
      supportsAllDrives: true
    });
    return resp.data.id!;
  };
  
  const newBaseFolderId = await createFolder(baseFolderName, parentFolderId);
  onLog(`Creating internal folders...`);
  const forPrintFolderId = await createFolder("For Print", newBaseFolderId);
  const bidderReceiptsFolderId = await createFolder("Bidder Receipts", newBaseFolderId);
  await createFolder("Software Development", newBaseFolderId);
  const volunteerDocsFolderId = await createFolder("Helpful Volunteer Documents", newBaseFolderId);
  
  // 4. Copy specific template files
  onLog(`Copying template files...`);
  const templateFiles = [  
    { id: process.env.TEMPLATE_VOLUNTEER_BUSINESS_FOLLOWUP_FAQS_ID!, parent: volunteerDocsFolderId }, 
    { id: process.env.TEMPLATE_VOLUNTEER_EMAIL_SCRIPT_AND_TALKING_POINTS_ID!, parent: volunteerDocsFolderId }, 
    { id: process.env.TEMPLATE_NIGHT_OF_AUCTION_VOLUNTEERS_ID!, parent: newBaseFolderId },      
    { id: process.env.TEMPLATE_REPEAT_DONOR_LETTER_ID!, parent: newBaseFolderId },      
    { id: process.env.TEMPLATE_NEW_DONOR_LETTER_ID!, parent: newBaseFolderId },      
    { id: process.env.TEMPLATE_DONATION_FORM_ID!, parent: newBaseFolderId },      
    { id: process.env.TEMPLATE_PROJECT_MANAGEMENT_TEMPLATE_ID!, parent: newBaseFolderId },      
    { id: process.env.TEMPLATE_INITIAL_PLANNING_MEETING_ID!, parent: newBaseFolderId }       
  ];
  
  for (const f of templateFiles) {
    if (!f.id) {
      onLog(`Skipping file copy: template environment variable not configured.`);
      continue;
    }
    try {
      const originalFile = await drive.files.get({ fileId: f.id, fields: "name", supportsAllDrives: true });
      onLog(`Copying template file: ${originalFile.data.name || f.id}`);
      await drive.files.copy({
        fileId: f.id,
        requestBody: { name: originalFile.data.name || "Copied File", parents: [f.parent] },
        fields: "id",
        supportsAllDrives: true
      });
    } catch (err: any) {
      onLog(`Failed to copy file ${f.id}: ${err.message}`);
    }
  }
  
  // 5. Backup master spreadsheets dynamically if they exist, into lastYearFolderId
  if (lastYearFolderId) {
    onLog(`Backing up master spreadsheets to last year's folder (${lastYear})...`);
    if (ticketsSpreadsheetId) {
      onLog(`Backing up Tickets spreadsheet...`);
      await drive.files.copy({
        fileId: ticketsSpreadsheetId,
        requestBody: { name: `${lastYear} Auction Tickets`, parents: [lastYearFolderId] },
        supportsAllDrives: true
      }).catch(err => onLog(`Error backing up Tickets: ${err.message}`));
    }
    
    if (itemEntrySpreadsheetId) {
      onLog(`Backing up Item Entry spreadsheet...`);
      await drive.files.copy({
        fileId: itemEntrySpreadsheetId,
        requestBody: { name: `${lastYear} Auction Items`, parents: [lastYearFolderId] },
        supportsAllDrives: true
      }).catch(err => onLog(`Error backing up Items: ${err.message}`));
    }
    
    if (bidManagementSpreadsheetId) {
      onLog(`Backing up Bid Management spreadsheet...`);
      await drive.files.copy({
        fileId: bidManagementSpreadsheetId,
        requestBody: { name: `${lastYear} Bid Management`, parents: [lastYearFolderId] },
        supportsAllDrives: true
      }).catch(err => onLog(`Error backing up Bid Management: ${err.message}`));
    }
  } else {
    onLog(`No folder found for ${lastYear} Auction, skipping spreadsheet backups.`);
  }
  
  // 6. Clean master spreadsheets
  onLog(`Cleaning data from master spreadsheets...`);
  try {
    if (itemEntrySpreadsheetId) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: itemEntrySpreadsheetId,
        range: "Auction-Items!A2:Z"
      }).catch(err => onLog(`Failed to clear Item Entry sheets: ${err.message}`));
    }

    if (ticketsSpreadsheetId) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: ticketsSpreadsheetId,
        range: "'tickets'!A2:Z"
      }).catch(err => onLog(`Failed to clear tickets sheet: ${err.message}`));

      await sheets.spreadsheets.values.clear({
        spreadsheetId: ticketsSpreadsheetId,
        range: "'sponsor tickets'!A2:Z"
      }).catch(err => onLog(`Failed to clear sponsor tickets: ${err.message}`));
    }

    if (bidManagementSpreadsheetId) {
      const shtInfo = await sheets.spreadsheets.get({ spreadsheetId: bidManagementSpreadsheetId });
      const shts = shtInfo.data.sheets || [];

      const reqs: any[] = [];

      shts.forEach(sheet => {
        const nm = sheet.properties?.title;
        const id = sheet.properties?.sheetId;
        const deleteSheetsList = ["Auction-Items", "Bid-Management", "Bidder-Numbers"];
        if (nm && deleteSheetsList.includes(nm) && id !== undefined) {
           reqs.push({ deleteSheet: { sheetId: id } });
        }
      });

      if (reqs.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: bidManagementSpreadsheetId,
          requestBody: { requests: reqs }
        }).catch(err => onLog(`Failed deleting sheets from Bid Management: ${err.message}`));
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: bidManagementSpreadsheetId,
        range: "'Auction-Status'!A2",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[true]] }
      }).catch(err => onLog(`Failed to reset Auction-Status: ${err.message}`));

      await sheets.spreadsheets.values.clear({
        spreadsheetId: bidManagementSpreadsheetId,
        range: "'Special-Winners'!B2:B3"
      }).catch(err => onLog(`Failed to clear Special-Winners: ${err.message}`));

      await sheets.spreadsheets.values.clear({
        spreadsheetId: bidManagementSpreadsheetId,
        range: "'Follow-Up'!A2:Z"
      }).catch(err => onLog(`Failed to clear Follow-Up: ${err.message}`));
    }
  } catch (err: any) {
    onLog(`General error during sheet resets: ${err.message}`);
  }

  return {
    success: true,
    auctionYear,
    forPrintFolderId,
    bidderReceiptsFolderId
  };
}
