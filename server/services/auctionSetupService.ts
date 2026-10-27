import { drive_v3, sheets_v4 } from "googleapis";
import { AUCTION_TICKETS_ITEM_ID } from "../utils/categoryHelpers";
import { currentAuctionYear } from "../utils/auctionYear";
import { archiveAuctionSpreadsheets } from "./archiveService";
import { AUCTION_STATE_CELL } from "../utils/auctionState";

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
 * The 11 "standard" items that exist every auction to track things that
 * aren't really auction items - raffle tickets, open-appeal pledge tiers,
 * and general auction ticket sales. These used to be synthesized at
 * "Set Up Bid Management App" time into Bid Management's own (now-deleted)
 * local Items snapshot - never real rows in the master Auction-Items
 * spreadsheet at all. Once that snapshot mechanism was removed (see
 * CHANGELOG.md's "Eliminated Bid Management's separate, drifting Items
 * snapshot"), nothing created them anywhere, and they silently
 * disappeared. Seeding them for real, here, into the one spreadsheet
 * that's actually read everywhere (Items tab, Bid Entry, Checkout)
 * fixes that - and doing it as part of the same annual rollover this
 * function already runs means they can't silently vanish again next
 * year the way a manually-added row would when this same function
 * clears `Auction-Items!A2:Z` below.
 *
 * Category names match the id-range convention `categoryHelpers.ts`
 * already encodes (1401->Movie Night, 1501->Raffle Tickets,
 * 1601->Open Appeal, 1701->Auction Tickets - its own hundred-block base
 * now that it's a real category rather than living inside 1601-1605's
 * Open Appeal range); Value/Opening Bid/Min Raise are deliberately left
 * blank (matching the old removed seeding, which never set a price
 * either) so the organizer sets the real dollar amounts once and they
 * carry forward with the spreadsheet. `status: "Active"` is required,
 * not optional - Items.tsx's Auction Catalog only shows Active items.
 * The Auction Tickets row's ID is the shared `AUCTION_TICKETS_ITEM_ID`
 * constant, not a literal - `bidderService.ts` records every ticket
 * purchase as a bid-grid win of this exact item ID, so the two can never
 * drift apart.
 */
const STANDARD_ITEM_ROWS: (string | boolean)[][] = [
  ["1401", "Movie Night", "A Night with the ORNS Staff", "", "", "", "", "", "", "Active", "", "", true],
  ["1501", "Raffle Tickets", "One Raffle Ticket for a $500 Amazon Gift Card", "", "", "", "", "", "", "Active", "", "", true],
  ["1502", "Raffle Tickets", "Five Raffle Tickets for a $500 Amazon Gift Card", "", "", "", "", "", "", "Active", "", "", true],
  ["1503", "Raffle Tickets", "Ten Raffle Tickets for a $500 Amazon Gift Card", "", "", "", "", "", "", "Active", "", "", true],
  ["1504", "Raffle Tickets", "One 50/50 Raffle Ticket $20", "", "", "", "", "", "", "Active", "", "", true],
  ["1601", "Open Appeal", "Open Appeal for $500", "", "", "", "", "", "", "Active", "", "", true],
  ["1602", "Open Appeal", "Open Appeal for $250", "", "", "", "", "", "", "Active", "", "", true],
  ["1603", "Open Appeal", "Open Appeal for $100", "", "", "", "", "", "", "Active", "", "", true],
  ["1604", "Open Appeal", "Open Appeal for $50", "", "", "", "", "", "", "Active", "", "", true],
  ["1605", "Open Appeal", "Open Appeal for $25", "", "", "", "", "", "", "Active", "", "", true],
  [AUCTION_TICKETS_ITEM_ID, "Auction Tickets", "Auction Tickets", "", "", "", "", "", "", "Active", "", "", true],
];

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
  const auctionYear = currentAuctionYear();
  const lastYear = auctionYear - 1;
  const maxArchiveYear = auctionYear - 2;
  const baseFolderName = `${auctionYear} Auction`;

  onLog(`Starting setup for auction year: ${auctionYear}`);

  // 2. Check for the new folder's existence and find last year's folder (old
  // folders are moved after the backup below, so a failed backup changes nothing)
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
  const foldersToArchive: { id: string; name: string }[] = [];
  
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
        foldersToArchive.push({ id: folder.id!, name: folder.name! });
      }
    }
  }

  // 3. Back up the master spreadsheets into last year's folder (created if
  // it's missing). This comes before anything else changes because step 6
  // permanently clears them: if any copy fails the whole setup stops here,
  // with nothing moved, created or cleared, so it can simply be run again
  // (copies that did succeed are kept and skipped next time). Names and
  // folder come from archiveAuctionSpreadsheets, which is what the Archived
  // Auctions page looks for; anything already archived with "Archive This
  // Auction" is left as it is.
  onLog(`Backing up master spreadsheets to last year's folder (${lastYear})...`);
  const backup = await archiveAuctionSpreadsheets(drive, {
    year: lastYear,
    parentFolderId,
    folderId: lastYearFolderId,
    spreadsheets: { tickets: ticketsSpreadsheetId, items: itemEntrySpreadsheetId, bidManagement: bidManagementSpreadsheetId },
    replaceExisting: false,
  }, onLog);
  const failedBackups = backup.results.filter((r) => r.status === "failed");
  if (failedBackups.length > 0) {
    throw new Error(
      `Setup stopped before changing anything because the backup failed (${failedBackups.map((f) => `${f.name}: ${f.error}`).join("; ")}). ` +
      `Your spreadsheets are untouched - fix the problem and run setup again.`
    );
  }

  for (const folder of foldersToArchive) {
    onLog(`Archiving old folder: ${folder.name}`);
    await drive.files.update({
      fileId: folder.id,
      addParents: archivedFolderId,
      removeParents: parentFolderId,
      fields: 'id',
      supportsAllDrives: true
    });
  }

  // 4. Create new folder and subfolders
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
  
  // 5. Copy specific template files
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
  
  // 6. Clean master spreadsheets
  onLog(`Cleaning data from master spreadsheets...`);
  try {
    if (itemEntrySpreadsheetId) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: itemEntrySpreadsheetId,
        range: "Auction-Items!A2:Z"
      }).catch(err => onLog(`Failed to clear Item Entry sheets: ${err.message}`));

      onLog(`Re-seeding the ${STANDARD_ITEM_ROWS.length} standard items (raffle tickets, open appeal, auction tickets)...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId: itemEntrySpreadsheetId,
        range: "Auction-Items!A2",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: STANDARD_ITEM_ROWS }
      }).catch(err => onLog(`Failed to re-seed standard items: ${err.message}`));
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
        const deleteSheetsList = ["Bid-Management", "Bidder-Numbers"];
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
        requestBody: { values: [[AUCTION_STATE_CELL.prep]] }
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
