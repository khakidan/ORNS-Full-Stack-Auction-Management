import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupNewAuction } from "../services/auctionSetupService";
import { currentAuctionYear } from "../utils/auctionYear";

const year = currentAuctionYear();
const lastYear = year - 1;

/** Drive/Sheets fakes recording every folder created and file copied. */
function fakes(existingFolders: { id: string; name: string }[], failCopyOf?: string) {
  const created: { name: string; parents: string[] }[] = [];
  const copied: { fileId: string; name: string; parents: string[] }[] = [];
  let n = 0;
  const drive = {
    files: {
      list: vi.fn(async () => ({ data: { files: existingFolders } })),
      create: vi.fn(async ({ requestBody }: any) => {
        created.push({ name: requestBody.name, parents: requestBody.parents });
        return { data: { id: `new-${++n}` } };
      }),
      copy: vi.fn(async ({ fileId, requestBody }: any) => {
        if (fileId === failCopyOf) throw new Error("quota exceeded");
        copied.push({ fileId, name: requestBody.name, parents: requestBody.parents });
        return { data: { id: "copy" } };
      }),
      get: vi.fn(async () => ({ data: { name: "t" } })),
      update: vi.fn(async () => ({ data: {} })),
    },
  } as any;
  const ok = vi.fn(async () => ({ data: {} }));
  const sheets = {
    spreadsheets: { get: vi.fn(async () => ({ data: { sheets: [] } })), batchUpdate: ok, values: { clear: ok, update: ok } },
  } as any;
  return { drive, sheets, created, copied, clear: ok };
}

const params = { ticketsSpreadsheetId: "tk", itemEntrySpreadsheetId: "it", bidManagementSpreadsheetId: "bm" };

describe("setupNewAuction - archiving last year's spreadsheets", () => {
  beforeEach(() => {
    vi.stubEnv("DRIVE_PARENT_FOLDER_ID", "parent");
    vi.stubEnv("DRIVE_ARCHIVE_FOLDER_ID", "archive");
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("copies the three spreadsheets into last year's existing folder under the names the Archived Auctions page looks for", async () => {
    const { drive, sheets, copied: allCopies } = fakes([{ id: "last", name: `${lastYear} Auction` }]);

    await setupNewAuction(drive, sheets, params, () => {});

    const copied = allCopies.filter((c) => ["tk", "it", "bm"].includes(c.fileId));
    expect(copied).toEqual([
      { fileId: "tk", name: `${lastYear} Auction Tickets`, parents: ["last"] },
      { fileId: "it", name: `${lastYear} Auction Items`, parents: ["last"] },
      { fileId: "bm", name: `${lastYear} Bid Management`, parents: ["last"] },
    ]);
  });

  it("creates last year's folder in the main auction folder when it's missing, and archives into it, instead of skipping the backup before the data is cleared", async () => {
    const { drive, sheets, created, copied: allCopies } = fakes([]);

    await setupNewAuction(drive, sheets, params, () => {});

    const copied = allCopies.filter((c) => ["tk", "it", "bm"].includes(c.fileId));

    const lastYearFolder = created.find((c) => c.name === `${lastYear} Auction`);
    expect(lastYearFolder?.parents).toEqual(["parent"]);
    expect(copied).toHaveLength(3);
    const folderId = `new-${created.indexOf(lastYearFolder!) + 1}`;
    expect(copied.every((c) => c.parents[0] === folderId)).toBe(true);
  });

  it("stops before moving, creating or clearing anything when a backup copy fails, so no data is lost and setup can simply be re-run", async () => {
    const { drive, sheets, created, clear } = fakes(
      [{ id: "last", name: `${lastYear} Auction` }, { id: "old", name: `${year - 2} Auction` }],
      "bm"
    );

    await expect(setupNewAuction(drive, sheets, params, () => {})).rejects.toThrow(/backup failed.*untouched/);

    expect(clear).not.toHaveBeenCalled();
    expect(sheets.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(created.find((c) => c.name === `${year} Auction`)).toBeUndefined();
    expect(drive.files.update).not.toHaveBeenCalled(); // the old year's folder is not moved to the archive folder
  });

  it("treats a copy that was already archived as fine and carries on to clear the sheets", async () => {
    const { drive, sheets, clear } = fakes([{ id: "last", name: `${lastYear} Auction` }]);
    // every children listing returns the same "already there" files
    drive.files.list.mockResolvedValue({ data: { files: [
      { id: "x1", name: `${lastYear} Auction` },
      { id: "x2", name: `${lastYear} Auction Tickets` },
      { id: "x3", name: `${lastYear} Auction Items` },
      { id: "x4", name: `${lastYear} Bid Management` },
    ] } });

    await setupNewAuction(drive, sheets, params, () => {});

    expect(clear).toHaveBeenCalled();
  });
});
