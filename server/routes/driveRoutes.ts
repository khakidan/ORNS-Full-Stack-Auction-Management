import { Router, Request, Response, NextFunction } from 'express';
import { driveFor, respondIfNotFound } from '../utils/googleClients';
import { isDriveId, listFolderFiles } from '../services/driveService';

/** Lists a Drive folder's files for the document panels. */
export default function createDriveRouter() {
  const router = Router();

  router.get("/drive/files/:folderId", async (req: Request, res: Response, next: NextFunction) => {
    const { folderId } = req.params;
    if (!folderId || folderId === "undefined" || folderId === "null") {
      return res.json([]);
    }
    if (!isDriveId(folderId)) {
      return res.status(400).json({ error: "That isn't a valid Drive folder ID. Please check the folder ID in Settings." });
    }

    try {
      res.json(await listFolderFiles(driveFor(req), folderId));
    } catch (error: any) {
      console.error(`[Drive API] Error fetching files:`, error);
      if (respondIfNotFound(error, res, "Folder not found. Please check the folder ID in Settings.")) return;
      next(error);
    }
  });

  return router;
}
