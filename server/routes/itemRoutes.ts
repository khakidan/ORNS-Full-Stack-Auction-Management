import { Router, Request, Response, NextFunction } from 'express';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { addItem, deleteItem, updateItem, bulkUpdateItems, ItemChangedError } from '../services/itemService';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { sheetsFor } from '../utils/googleClients';

/** Auction-Items add / edit / bulk edit / delete. Each service call holds the `auction-items:` lock. */
export default function createItemRouter() {
  const router = Router();

  // Add Auction Item and resequence
  router.post("/auction/add-item", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, category, name, description, value, donor, itemType, allowMultipleWinners, idempotencyKey } = req.body;
    if (!spreadsheetId || !category || !name) {
      return res.status(400).json({ error: "Missing required parameters for adding item" });
    }

    try {
      const outcome = await withIdempotency("auction/add-item", idempotencyKey, () =>
        addItem(sheetsFor(req), {
          spreadsheetId,
          category,
          name,
          description,
          value,
          donor,
          itemType,
          allowMultipleWinners: !!allowMultipleWinners
        })
      );
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Server Error] add-item:", error);
      next(error);
    }
  });

  // Delete Auction Item Row. Carries an idempotencyKey like its siblings:
  // re-deleting a blanked row is harmless, but a retried duplicate still
  // short-circuits like every other mutating route.
  router.post("/auction/delete-item", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, rowIndex, idempotencyKey } = req.body;
    if (!spreadsheetId || !rowIndex) {
      return res.status(400).json({ error: "Missing required parameters for deletion" });
    }

    try {
      const outcome = await withIdempotency("auction/delete-item", idempotencyKey, async () => {
        const result = await deleteItem(sheetsFor(req), { spreadsheetId, rowIndex });
        clearCacheForSpreadsheet(spreadsheetId);
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Server Error] delete-item:", error);
      next(error);
    }
  });

  // Save one item's changed fields (locked) & resequence IDs on a category/status change
  router.post("/auction/update-item", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, rowIndex, changes, expectedName } = req.body;
    if (!spreadsheetId || !Number.isInteger(rowIndex) || !changes || typeof changes !== "object" || Array.isArray(changes)) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    if (expectedName !== undefined && typeof expectedName !== "string") {
      return res.status(400).json({ error: "expectedName must be text" });
    }

    try {
      const result = await updateItem(sheetsFor(req), { spreadsheetId, rowIndex, changes, expectedName });
      res.json(result);
    } catch (error: any) {
      console.error("[Server Error] update-item:", error);
      if (error instanceof ItemChangedError) {
        return res.status(409).json({ error: error.message });
      }
      if (error.message?.includes("Invalid field") || /^Row \d+ not found$/.test(error.message || "")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Bulk Update Auction Item Rows & Manage Sequencing on Change
  router.post("/auction/bulk-update-items", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, rowIndices, field, value, idempotencyKey } = req.body;
    if (!spreadsheetId || !rowIndices || !rowIndices.length || !field) {
      return res.status(400).json({ error: "Missing required bulk update parameters" });
    }

    try {
      const outcome = await withIdempotency("auction/bulk-update-items", idempotencyKey, () =>
        bulkUpdateItems(sheetsFor(req), { spreadsheetId, rowIndices, field, value })
      );
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Server Error] bulk-update-items:", error);
      next(error);
    }
  });

  return router;
}
