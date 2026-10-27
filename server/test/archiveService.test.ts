import { describe, it, expect, vi } from "vitest";
import { findArchivedAuctions } from "../services/archiveService";
import { currentAuctionYear } from "../utils/auctionYear";

type Child = { id: string; name: string; webViewLink?: string };

/** A Drive fake that answers files.list by the parent ID in the query. */
function fakeDrive(childrenByParent: Record<string, Child[]>) {
  const list = vi.fn(async ({ q }: { q: string }) => {
    const parent = /'([^']+)' in parents/.exec(q)![1];
    return { data: { files: childrenByParent[parent] || [] } };
  });
  return { drive: { files: { list } } as any, list };
}

describe("findArchivedAuctions", () => {
  it("finds last year's folder in the parent folder and the year before's in the archive folder, with their spreadsheet copies", async () => {
    const { drive } = fakeDrive({
      parent: [{ id: "f2026", name: "2026 Auction", webViewLink: "https://drive/f2026" }, { id: "other", name: "Misc" }],
      archive: [{ id: "f2025", name: "2025 Auction" }],
      f2026: [{ id: "bm26", name: "2026 Bid Management" }, { id: "it26", name: "2026 Auction Items" }, { id: "tk26", name: "2026 Auction Tickets" }],
      f2025: [{ id: "bm25", name: "2025 Bid Management" }],
    });

    const result = await findArchivedAuctions(drive, "parent", "archive", [2026, 2025]);

    expect(result[0]).toEqual({
      year: 2026,
      folderId: "f2026",
      folderLink: "https://drive/f2026",
      bidManagementSpreadsheetId: "bm26",
      itemsSpreadsheetId: "it26",
    });
    expect(result[1]).toMatchObject({
      year: 2025,
      folderId: "f2025",
      folderLink: "https://drive.google.com/drive/folders/f2025",
      bidManagementSpreadsheetId: "bm25",
      itemsSpreadsheetId: null,
    });
  });

  it("prefers the exact \"{year} ...\" name but accepts a hand-moved file whose name only contains Bid Management / Auction Items", async () => {
    const { drive } = fakeDrive({
      parent: [{ id: "f2026", name: "2026 Auction" }],
      archive: [],
      f2026: [
        { id: "tk", name: "2026 Auction Tickets" },
        { id: "bm-copy", name: "Copy of 2026 Bid Management" },
        { id: "it-old", name: "ORNS Auction Items (2026)" },
        { id: "it-exact", name: "2026 Auction Items" },
      ],
    });

    const [result] = await findArchivedAuctions(drive, "parent", "archive", [2026]);

    expect(result.bidManagementSpreadsheetId).toBe("bm-copy");
    expect(result.itemsSpreadsheetId).toBe("it-exact");
  });

  it("returns nulls, not an error, for a year with no folder in either location", async () => {
    const { drive } = fakeDrive({ parent: [], archive: [] });

    const result = await findArchivedAuctions(drive, "parent", "archive", [2026]);

    expect(result).toEqual([
      { year: 2026, folderId: null, folderLink: null, bidManagementSpreadsheetId: null, itemsSpreadsheetId: null },
    ]);
  });

  it("refuses a folder ID that isn't a plain Drive ID, since it is spliced into the query", async () => {
    const { drive, list } = fakeDrive({});

    await expect(findArchivedAuctions(drive, "x' or name contains '", "archive", [2026])).rejects.toThrow("Not a Drive ID");
    expect(list).not.toHaveBeenCalled();
  });
});

describe("currentAuctionYear", () => {
  it("is this year through April and next year from May on", () => {
    expect(currentAuctionYear(new Date(2027, 3, 30))).toBe(2027);
    expect(currentAuctionYear(new Date(2026, 4, 1))).toBe(2027);
    expect(currentAuctionYear(new Date(2026, 9, 26))).toBe(2027);
  });
});

describe("archiveAuctionSpreadsheets", () => {
  /** Drive fake: files.list answers by parent; copy/update/create are recorded. */
  function archiveDrive(childrenByParent: Record<string, Child[]>, failCopyOf?: string) {
    const calls = { created: [] as any[], copied: [] as any[], trashed: [] as string[] };
    const drive = {
      files: {
        list: vi.fn(async ({ q }: { q: string }) => {
          const parent = /'([^']+)' in parents/.exec(q)![1];
          const mime = q.includes("folder") ? "folder" : "sheet";
          return { data: { files: (childrenByParent[`${parent}:${mime}`] || childrenByParent[parent] || []) } };
        }),
        create: vi.fn(async ({ requestBody }: any) => { calls.created.push(requestBody); return { data: { id: "new-folder" } }; }),
        copy: vi.fn(async ({ fileId, requestBody }: any) => {
          if (fileId === failCopyOf) throw new Error("quota");
          calls.copied.push({ fileId, ...requestBody });
          return { data: { id: "c" } };
        }),
        update: vi.fn(async ({ fileId }: any) => { calls.trashed.push(fileId); return { data: {} }; }),
      },
    } as any;
    return { drive, calls };
  }
  const sheets = { tickets: "tk", items: "it", bidManagement: "bm" };

  it("copies the three spreadsheets into the year's existing folder under the names the archive page looks for", async () => {
    const { archiveAuctionSpreadsheets } = await import("../services/archiveService");
    const { drive, calls } = archiveDrive({ "parent:folder": [{ id: "f26", name: "2026 Auction" }], "f26:sheet": [] });

    const result = await archiveAuctionSpreadsheets(drive, { year: 2026, parentFolderId: "parent", spreadsheets: sheets, replaceExisting: true });

    expect(calls.created).toEqual([]);
    expect(calls.copied).toEqual([
      { fileId: "tk", name: "2026 Auction Tickets", parents: ["f26"] },
      { fileId: "it", name: "2026 Auction Items", parents: ["f26"] },
      { fileId: "bm", name: "2026 Bid Management", parents: ["f26"] },
    ]);
    expect(result.folderId).toBe("f26");
    expect(result.results.map((r) => r.status)).toEqual(["copied", "copied", "copied"]);
  });

  it("creates the year's folder in the main auction folder when there is none", async () => {
    const { archiveAuctionSpreadsheets } = await import("../services/archiveService");
    const { drive, calls } = archiveDrive({});

    const result = await archiveAuctionSpreadsheets(drive, { year: 2026, parentFolderId: "parent", spreadsheets: sheets, replaceExisting: false });

    expect(calls.created).toEqual([{ name: "2026 Auction", mimeType: "application/vnd.google-apps.folder", parents: ["parent"] }]);
    expect(calls.copied.every((c) => c.parents[0] === "new-folder")).toBe(true);
    expect(result.folderLink).toBe("https://drive.google.com/drive/folders/new-folder");
  });

  it("leaves an already-archived file alone when not replacing (the rollover), but replaces it - trashing the old copy only after the new one exists - when asked", async () => {
    const { archiveAuctionSpreadsheets } = await import("../services/archiveService");
    const children = { "parent:folder": [{ id: "f26", name: "2026 Auction" }], "f26:sheet": [{ id: "old-bm", name: "2026 Bid Management" }] };

    const keep = archiveDrive(children);
    const kept = await archiveAuctionSpreadsheets(keep.drive, { year: 2026, parentFolderId: "parent", spreadsheets: sheets, replaceExisting: false });
    expect(kept.results.find((r) => r.name === "2026 Bid Management")?.status).toBe("skipped");
    expect(keep.calls.trashed).toEqual([]);

    const replace = archiveDrive(children);
    const replaced = await archiveAuctionSpreadsheets(replace.drive, { year: 2026, parentFolderId: "parent", spreadsheets: sheets, replaceExisting: true });
    expect(replaced.results.find((r) => r.name === "2026 Bid Management")?.status).toBe("replaced");
    expect(replace.calls.trashed).toEqual(["old-bm"]);
  });

  it("reports a failed copy and keeps the earlier archive instead of trashing it", async () => {
    const { archiveAuctionSpreadsheets } = await import("../services/archiveService");
    const { drive, calls } = archiveDrive(
      { "parent:folder": [{ id: "f26", name: "2026 Auction" }], "f26:sheet": [{ id: "old-bm", name: "2026 Bid Management" }] },
      "bm"
    );

    const result = await archiveAuctionSpreadsheets(drive, { year: 2026, parentFolderId: "parent", spreadsheets: sheets, replaceExisting: true });

    expect(result.results.find((r) => r.name === "2026 Bid Management")).toEqual({ name: "2026 Bid Management", status: "failed", error: "quota" });
    expect(calls.trashed).toEqual([]);
  });
});
