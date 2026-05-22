import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../utils/auth';

export default function createAuctionRouter() {
  const router = Router();

  router.post("/setup-new", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const client = getAuthenticatedClient(req.session.tokens);
    const drive = google.drive({ version: "v3", auth: client });
    const sheets = google.sheets({ version: "v4", auth: client });

    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(`[Auction Setup] ${msg}`);
      logs.push(msg);
      res.write(JSON.stringify({ log: msg }) + "\n");
    };

    try {
      const parentFolderId = "0AFy4DQDukQdYUk9PVA";
      const archivedFolderId = "1J8fuh60tHdG_AAsl9fY8vpvstdXtxd-I";
      
      const { 
        ticketsSpreadsheetId, 
        itemEntrySpreadsheetId, 
        bidManagementSpreadsheetId 
      } = req.body;
      
      // 1. Calculate dates
      const today = new Date();
      let auctionYear = today.getFullYear();
      if (today.getMonth() > 3) {
        auctionYear += 1;
      }
      const lastYear = auctionYear - 1;
      const maxArchiveYear = auctionYear - 2;
      const baseFolderName = `${auctionYear} Auction`;

      log(`Starting setup for auction year: ${auctionYear}`);

      // 2. Archive old folders && check for new folder existence
      log(`Scanning parent directory for existing folders...`);
      const folderRes = await drive.files.list({
        q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id, name, parents)",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      
      log(`Found ${folderRes.data.files?.length || 0} existing folders in parent directory.`);
      
      const folders = folderRes.data.files || [];
      let lastYearFolderId: string | undefined;
      
      for (const folder of folders) {
        if (folder.name === baseFolderName) {
          log(`Error: Folder '${baseFolderName}' already exists.`);
          res.write(JSON.stringify({ error: `The '${baseFolderName}' folder already exists. Automation cancelled to prevent duplicates.` }) + "\n");
          return res.end();
        }
        
        const match = folder.name?.match(/^(\d{4}) Auction$/);
        if (match) {
          const folderYear = parseInt(match[1], 10);
          if (folderYear === lastYear) {
            lastYearFolderId = folder.id!;
          }
          if (folderYear <= maxArchiveYear) {
            log(`Archiving old folder: ${folder.name}`);
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
      log(`Creating new base folder: ${baseFolderName}`);
      const createFolder = async (name: string, parentId: string) => {
        const resp = await drive.files.create({
          requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
          fields: "id",
          supportsAllDrives: true
        });
        return resp.data.id!;
      };
      
      const newBaseFolderId = await createFolder(baseFolderName, parentFolderId);
      log(`Creating internal folders...`);
      const forPrintFolderId = await createFolder("For Print", newBaseFolderId);
      const bidderReceiptsFolderId = await createFolder("Bidder Receipts", newBaseFolderId);
      await createFolder("Software Development", newBaseFolderId);
      const volunteerDocsFolderId = await createFolder("Helpful Volunteer Documents", newBaseFolderId);
      
      // 4. Copy specific template files
      log(`Copying template files...`);
      const templateFiles = [  
        { id: "1GO-DvXuFfJLRyGgl9uavQl2Psn3kOPW9KkD8N9GQsvk", parent: volunteerDocsFolderId }, 
        { id: "1VSCNOc9f_usm0cNlUUyoT9TmKKouTJIOM0IQPSG21UU", parent: volunteerDocsFolderId }, 
        { id: "1rKooSWG2CxyAGowhjPpgw7-mZs8oklkYGVSpRsAYkyU", parent: newBaseFolderId },      
        { id: "1qQKGSIZxLK5OuE7uuXs6hQpDQIDc_IFOwP0nr3fXTYc", parent: newBaseFolderId },      
        { id: "1eA_7adFmclf8e5_PT-dTGgwfsDcNF8GjsA-wnxOFiyU", parent: newBaseFolderId },      
        { id: "1ON6sSUpQQdmpVsVPPCju-gKk-2Cf97RF2MM-t11Lfac", parent: newBaseFolderId },      
        { id: "10XqwqwSdjNv0PQfYTYgyCQ8WZBG5EXS-p75vm5lHLFs", parent: newBaseFolderId },      
        { id: "1ddUrxLA6A3LqUhArhuB3MuOC5z43eJmkts596aiUYOw", parent: newBaseFolderId }       
      ];
      
      for (const f of templateFiles) {
        try {
          const originalFile = await drive.files.get({ fileId: f.id, fields: "name", supportsAllDrives: true });
          log(`Copying template file: ${originalFile.data.name || f.id}`);
          await drive.files.copy({
            fileId: f.id,
            requestBody: { name: originalFile.data.name || "Copied File", parents: [f.parent] },
            fields: "id",
            supportsAllDrives: true
          });
        } catch (err: any) {
          log(`Failed to copy file ${f.id}: ${err.message}`);
        }
      }
      
      // 5. Backup master spreadsheets dynamically if they exist, into lastYearFolderId
      if (lastYearFolderId) {
        log(`Backing up master spreadsheets to last year's folder (${lastYear})...`);
        if (ticketsSpreadsheetId) {
          log(`Backing up Tickets spreadsheet...`);
          await drive.files.copy({
            fileId: ticketsSpreadsheetId,
            requestBody: { name: `${lastYear} Auction Tickets`, parents: [lastYearFolderId] },
            supportsAllDrives: true
          }).catch(err => log(`Error backing up Tickets: ${err.message}`));
        }
        
        if (itemEntrySpreadsheetId) {
          log(`Backing up Item Entry spreadsheet...`);
          await drive.files.copy({
            fileId: itemEntrySpreadsheetId,
            requestBody: { name: `${lastYear} Auction Items`, parents: [lastYearFolderId] },
            supportsAllDrives: true
          }).catch(err => log(`Error backing up Items: ${err.message}`));
        }
        
        if (bidManagementSpreadsheetId) {
          log(`Backing up Bid Management spreadsheet...`);
          await drive.files.copy({
            fileId: bidManagementSpreadsheetId,
            requestBody: { name: `${lastYear} Bid Management`, parents: [lastYearFolderId] },
            supportsAllDrives: true
          }).catch(err => log(`Error backing up Bid Management: ${err.message}`));
        }
      } else {
        log(`No folder found for ${lastYear} Auction, skipping spreadsheet backups.`);
      }
      
      // 6. Clean master spreadsheets
      log(`Cleaning data from master spreadsheets...`);
      try {
        if (itemEntrySpreadsheetId) {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: itemEntrySpreadsheetId,
            range: "Auction-Items!A2:Z"
          }).catch(err => console.error("Failed to clear Item Entry sheets", err));
        }
        
        if (ticketsSpreadsheetId) {
          await sheets.spreadsheets.values.clear({
            spreadsheetId: ticketsSpreadsheetId,
            range: "'tickets'!A2:Z"
          }).catch(err => console.error("Failed to clear tickets sheet", err));
          
          await sheets.spreadsheets.values.clear({
            spreadsheetId: ticketsSpreadsheetId,
            range: "'sponsor tickets'!A2:Z"
          }).catch(err => console.error("Failed to clear sponsor tickets", err));
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
            }).catch(err => console.error("Failed deleting sheets", err));
          }
  
          await sheets.spreadsheets.values.update({
            spreadsheetId: bidManagementSpreadsheetId,
            range: "'Auction-Status'!A2",
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[true]] }
          }).catch(err => console.error("Failed Auction-Status", err));
  
          await sheets.spreadsheets.values.clear({
            spreadsheetId: bidManagementSpreadsheetId,
            range: "'Special-Winners'!B2:B3"
          }).catch(err => console.error("Failed Special-Winners clear", err));
  
          await sheets.spreadsheets.values.clear({
            spreadsheetId: bidManagementSpreadsheetId,
            range: "'Follow-Up'!A2:Z"
          }).catch(err => console.error("Failed Follow-Up clear", err));
        }
      } catch (err) {
        console.error("General error during sheet resets", err);
      }
      
      log(`Setup for new auction completed successfully!`);
  
      res.write(JSON.stringify({
        success: true,
        auctionYear,
        forPrintFolderId,
        bidderReceiptsFolderId,
        logs
      }) + "\n");
      res.end();
  
    } catch (error: any) {
      next(error);
    }
  });

  return router;
}
