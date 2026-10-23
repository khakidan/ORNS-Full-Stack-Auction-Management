import { drive_v3 } from "googleapis";

/** Drive IDs are only letters, digits, - and _. */
export function isDriveId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id);
}

/**
 * The files directly inside a Drive folder (shared drives included),
 * newest first. `folderId` must pass isDriveId: it is spliced into the
 * Drive query, so anything else would be query syntax (ROADMAP.md L7).
 */
export async function listFolderFiles(drive: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  if (!isDriveId(folderId)) throw new Error(`Not a Drive ID: ${folderId}`);
  const result = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, webViewLink, iconLink, modifiedTime)",
    orderBy: "modifiedTime desc",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives",
  });
  return result.data.files || [];
}
