import { drive_v3 } from "googleapis";
import { isDriveId } from "./driveService";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

export interface ArchivedAuction {
  year: number;
  /** The "{year} Auction" folder, or null if neither Drive location has one. */
  folderId: string | null;
  folderLink: string | null;
  /** "{year} Bid Management" - holds the Bidder-Numbers and Bid-Management sheets. */
  bidManagementSpreadsheetId: string | null;
  /** "{year} Auction Items" - holds the Auction-Items sheet. */
  itemsSpreadsheetId: string | null;
  /** "{year} Action History" - who did what that season. */
  actionHistorySpreadsheetId: string | null;
}

async function findChildren(drive: drive_v3.Drive, parentId: string, mimeType: string): Promise<drive_v3.Schema$File[]> {
  if (!isDriveId(parentId)) throw new Error(`Not a Drive ID: ${parentId}`);
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='${mimeType}' and trashed=false`,
    fields: "files(id, name, webViewLink)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
    pageSize: 200,
  });
  return res.data.files || [];
}

/**
 * Finds where each of `years`' auction was archived on Drive. The
 * "Setup New Auction Year" rollover copies the three master spreadsheets
 * into "{year} Auction" before clearing them (auctionSetupService.ts) and,
 * a year later, moves that folder from the parent folder into the archive
 * folder - so a year's folder can be in either. A year with no folder, or
 * a folder missing a copy, comes back with nulls rather than an error:
 * the page reports "not enough information" for it.
 */
export async function findArchivedAuctions(
  drive: drive_v3.Drive,
  parentFolderId: string,
  archiveFolderId: string,
  years: number[]
): Promise<ArchivedAuction[]> {
  for (const id of [parentFolderId, archiveFolderId]) {
    if (!isDriveId(id)) throw new Error(`Not a Drive ID: ${id}`);
  }
  const [inParent, inArchive] = await Promise.all([
    findChildren(drive, parentFolderId, FOLDER_MIME),
    findChildren(drive, archiveFolderId, FOLDER_MIME),
  ]);
  const folders = [...inParent, ...inArchive];

  return Promise.all(
    years.map(async (year): Promise<ArchivedAuction> => {
      const folder = folders.find((f) => f.name === `${year} Auction`);
      if (!folder?.id) {
        return { year, folderId: null, folderLink: null, bidManagementSpreadsheetId: null, itemsSpreadsheetId: null, actionHistorySpreadsheetId: null };
      }
      const sheets = await findChildren(drive, folder.id, SHEET_MIME);
      // The rollover names them exactly "{year} Bid Management" etc.; a file
      // moved in by hand may be named a little differently, so fall back to
      // any spreadsheet in the year's folder whose name contains the kind.
      const idOf = (kind: string) =>
        (sheets.find((f) => f.name === `${year} ${kind}`) ??
          sheets.find((f) => f.name?.toLowerCase().includes(kind.toLowerCase())))?.id ?? null;
      return {
        year,
        folderId: folder.id,
        folderLink: folder.webViewLink ?? `https://drive.google.com/drive/folders/${folder.id}`,
        bidManagementSpreadsheetId: idOf("Bid Management"),
        itemsSpreadsheetId: idOf("Auction Items"),
        actionHistorySpreadsheetId: idOf("Action History"),
      };
    })
  );
}

export interface ArchiveSpreadsheets {
  tickets?: string;
  items?: string;
  bidManagement?: string;
  actionHistory?: string;
}

export interface ArchiveCopyResult {
  /** The archived file's name, e.g. "2026 Bid Management". */
  name: string;
  /** "replaced" = a copy with this name already existed and was moved to the Drive trash. */
  status: "copied" | "replaced" | "skipped" | "failed";
  error?: string;
}

export interface ArchiveAuctionResult {
  year: number;
  folderId: string;
  folderLink: string;
  results: ArchiveCopyResult[];
}

/**
 * Copies a year's three master spreadsheets into its "{year} Auction"
 * folder under the names findArchivedAuctions() looks for - the one place
 * those names are defined. The folder is created in `parentFolderId` if
 * `folderId` isn't given and none exists. Does not clear anything.
 *
 * A file whose archived name already exists in the folder is left alone
 * (`replaceExisting` false: the rollover, so it never clobbers an archive
 * made earlier) or replaced (true: the user archived again on purpose).
 * Replacing copies first and only then moves the old file to the Drive
 * trash, so a failed copy never loses the earlier archive.
 */
export async function archiveAuctionSpreadsheets(
  drive: drive_v3.Drive,
  params: { year: number; parentFolderId: string; folderId?: string; spreadsheets: ArchiveSpreadsheets; replaceExisting: boolean },
  onLog: (msg: string) => void = () => {}
): Promise<ArchiveAuctionResult> {
  const { year, parentFolderId, spreadsheets, replaceExisting } = params;
  if (!isDriveId(parentFolderId)) throw new Error(`Not a Drive ID: ${parentFolderId}`);

  let folderId = params.folderId;
  if (!folderId) {
    const folders = await findChildren(drive, parentFolderId, FOLDER_MIME);
    folderId = folders.find((f) => f.name === `${year} Auction`)?.id ?? undefined;
  }
  if (!folderId) {
    onLog(`No "${year} Auction" folder found - creating it so the spreadsheets have somewhere to be archived.`);
    const created = await drive.files.create({
      requestBody: { name: `${year} Auction`, mimeType: FOLDER_MIME, parents: [parentFolderId] },
      fields: "id",
      supportsAllDrives: true,
    });
    folderId = created.data.id!;
  }

  const existing = await findChildren(drive, folderId, SHEET_MIME);
  const wanted: [string | undefined, string][] = [
    [spreadsheets.tickets, `${year} Auction Tickets`],
    [spreadsheets.items, `${year} Auction Items`],
    [spreadsheets.bidManagement, `${year} Bid Management`],
    [spreadsheets.actionHistory, `${year} Action History`],
  ];

  const results: ArchiveCopyResult[] = [];
  for (const [sourceId, name] of wanted) {
    if (!sourceId) continue;
    const old = existing.filter((f) => f.name === name);
    if (old.length > 0 && !replaceExisting) {
      onLog(`"${name}" is already archived - leaving it as it is.`);
      results.push({ name, status: "skipped" });
      continue;
    }
    try {
      onLog(`Archiving ${name}...`);
      await drive.files.copy({
        fileId: sourceId,
        requestBody: { name, parents: [folderId] },
        supportsAllDrives: true,
      });
      for (const f of old) {
        await drive.files.update({ fileId: f.id!, requestBody: { trashed: true }, supportsAllDrives: true });
      }
      results.push({ name, status: old.length > 0 ? "replaced" : "copied" });
    } catch (err: any) {
      onLog(`Error archiving ${name}: ${err.message}`);
      results.push({ name, status: "failed", error: err.message });
    }
  }

  return { year, folderId, folderLink: `https://drive.google.com/drive/folders/${folderId}`, results };
}
