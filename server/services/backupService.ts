import { sheets_v4 } from "googleapis";

export interface BackupSheet {
  title: string;
  sheetId: number | null | undefined;
  index: number | null | undefined;
}

export async function listBackups(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<BackupSheet[]> {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  return metadata.data.sheets?.filter(s => 
    s.properties?.title?.startsWith("Auction-Items Back Up (")
  ).map(s => ({
    title: s.properties?.title,
    sheetId: s.properties?.sheetId,
    index: s.properties?.index
  })) || [];
}

export async function restoreBackup(sheets: sheets_v4.Sheets, spreadsheetId: string, backupSheetName: string): Promise<{ success: boolean }> {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsList = metadata.data.sheets || [];
  
  const currentSheet = sheetsList.find(s => s.properties?.title === "Auction-Items");
  const backupSheet = sheetsList.find(s => s.properties?.title === backupSheetName);

  if (!backupSheet) throw new Error("Backup sheet not found");

  const requests: any[] = [];
  const timestamp = new Date().getTime();

  // 1. Rename current to an archive name
  if (currentSheet) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: currentSheet.properties?.sheetId,
          title: `Auction-Items (Archived ${timestamp})`
        },
        fields: "title"
      }
    });
  }

  // 2. Duplicate backup sheet
  requests.push({
    duplicateSheet: {
      sourceSheetId: backupSheet.properties?.sheetId,
      newSheetName: "Auction-Items",
      insertSheetIndex: 0
    }
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests }
  });

  return { success: true };
}
