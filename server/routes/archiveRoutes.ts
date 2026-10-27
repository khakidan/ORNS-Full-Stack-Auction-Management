import { Router, Request, Response, NextFunction } from 'express';
import { driveFor } from '../utils/googleClients';
import { currentAuctionYear } from '../utils/auctionYear';
import { findArchivedAuctions } from '../services/archiveService';

/** The past two auctions' archived spreadsheets, for the Archived Auctions page. */
export default function createArchiveRouter() {
  const router = Router();

  router.get("/archive/auctions", async (req: Request, res: Response, next: NextFunction) => {
    const parentFolderId = process.env.DRIVE_PARENT_FOLDER_ID;
    const archiveFolderId = process.env.DRIVE_ARCHIVE_FOLDER_ID;
    if (!parentFolderId || !archiveFolderId) {
      return res.status(500).json({ error: "DRIVE_PARENT_FOLDER_ID or DRIVE_ARCHIVE_FOLDER_ID is not configured on the server." });
    }

    try {
      const year = currentAuctionYear();
      res.json({ auctions: await findArchivedAuctions(driveFor(req), parentFolderId, archiveFolderId, [year - 1, year - 2]) });
    } catch (error: any) {
      console.error("[Archive API] Error finding archived auctions:", error);
      next(error);
    }
  });

  return router;
}
