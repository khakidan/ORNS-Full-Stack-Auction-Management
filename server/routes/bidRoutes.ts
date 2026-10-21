import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getColumnLetter } from '../utils/columnUtils';
import { getAuthenticatedClient } from '../services/oauth';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { executeGoogleSheetsTransaction, SheetOp } from '../services/sheetsService';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { registerWalkInBidder, checkInBidderWithBid } from '../services/bidderService';
import { recordWinningBid, checkoutMarkPaid, closeAuctionAndCleanup } from '../services/auctionService';
import { requireAuth } from '../middleware/requireAuth';

export default function createBidRouter() {
  const router = Router();
  router.use(requireAuth);

  // Record winning bid with follow-up logic
  router.post("/auction/record-winning-bid", async (req: Request, res: Response, next: NextFunction) => {
    const {
      bidderId, 
      itemId, 
      price, 
      spreadsheetId, 
      bidManagementSheet, 
      bidderNumbersSheet,
      idempotencyKey 
    } = req.body;

    if (!bidderId || !itemId || !price || !spreadsheetId || !bidManagementSheet || !bidderNumbersSheet) {
      return res.status(400).json({ error: "Missing required fields for recording winning bid." });
    }

    // Found in a hardening audit (docs/agents/refactor-opportunities.md's
    // Code Hardening item #1 / CHANGELOG.md): the `!price` check above only
    // rejects falsy values, not non-numeric ones. A non-numeric price used
    // to get stored as-is, and receiptDataService.ts's resolveWonItems
    // (`parseFloat(...) || 0`) would then silently treat it as $0 - the
    // item recorded as "won" but invoiced for nothing, with no error
    // surfaced anywhere.
    const numericPrice = typeof price === "number" ? price : parseFloat(price);
    if (isNaN(numericPrice) || !isFinite(numericPrice)) {
      return res.status(400).json({ error: "price must be a valid number." });
    }

    try {
      const outcome = await withIdempotency("auction/record-winning-bid", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        const result = await recordWinningBid(sheets, {
          bidderId,
          itemId,
          price: numericPrice,
          spreadsheetId,
          bidManagementSheet,
          bidderNumbersSheet
        });

        clearCacheForSpreadsheet(spreadsheetId);
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Route Error] record-winning-bid:", error);
      if (error.message.includes("not found")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // transactional checkout
  router.post("/auction/checkout-mark-paid", async (req: Request, res: Response, next: NextFunction) => {
    const {
      bidderId,
      spreadsheetId,
      itemsSpreadsheetId,
      ticketsSpreadsheetId,
      bidderNumbersSheet,
      attendeeInfo,
      paymentMethod,
      paypalIsSandbox,
      idempotencyKey
    } = req.body;

    if (!spreadsheetId || !bidderId || !bidderNumbersSheet) {
      return res.status(400).json({ error: "Missing required parameters for checkout" });
    }

    try {
      const outcome = await withIdempotency("auction/checkout-mark-paid", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);

        const result = await checkoutMarkPaid(client, {
          bidderId: String(bidderId),
          spreadsheetId,
          itemsSpreadsheetId,
          ticketsSpreadsheetId,
          bidderNumbersSheet,
          paymentMethod: paymentMethod || "cash",
          paypalIsSandbox,
          attendeeInfo
        });

        clearCacheForSpreadsheet(spreadsheetId);
        if (ticketsSpreadsheetId) clearCacheForSpreadsheet(ticketsSpreadsheetId);
        return result;
      });
      const body = idempotentBody(outcome);

      if (body.deferred) {
        res.status(202).json({
          ...body,
          message: "Verification deferred",
          bidderId: String(bidderId)
        });
      } else {
        res.status(200).json(body);
      }
    } catch (error: any) {
      console.error("[Route Error] checkout-mark-paid:", error);
      if (error.message.includes("not found") || error.message.includes("is not configured")) {
        return res.status(error.message.includes("configured") ? 500 : 400).json({ error: error.message });
      }
      next(error);
    }
  });

  router.post("/auction/close-and-cleanup", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, bidderNumbersSheet, bidManagementSheet } = req.body;
    if (!spreadsheetId || !bidderNumbersSheet || !bidManagementSheet) {
      return res.status(400).json({ error: "Missing required spreadsheet parameters for cleanup." });
    }

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await closeAuctionAndCleanup(sheets, {
        spreadsheetId,
        bidderNumbersSheet,
        bidManagementSheet
      });

      clearCacheForSpreadsheet(spreadsheetId);

      res.json(result);
    } catch (error: any) {
      console.error("[Route Error] close-and-cleanup:", error);
      if (error.message.includes("not found")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Update walk-in to be transactional across sheets
  router.post("/bidders/walk-in", async (req: Request, res: Response, next: NextFunction) => {
    const {
      firstName, 
      lastName, 
      email, 
      spreadsheetId, 
      ticketsSpreadsheetId,
      ticketPrice,
      bidderNumbersSheet,
      bidManagementSheet,
      idempotencyKey 
    } = req.body;

    if (!firstName || !lastName || !spreadsheetId || !bidderNumbersSheet || !bidManagementSheet) {
      return res.status(400).json({ error: "Missing required fields for walk-in." });
    }

    try {
      const outcome = await withIdempotency("bidders/walk-in", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        const result = await registerWalkInBidder(sheets, {
          firstName,
          lastName,
          email,
          spreadsheetId,
          ticketsSpreadsheetId,
          ticketPrice,
          bidderNumbersSheet,
          bidManagementSheet
        });

        clearCacheForSpreadsheet(spreadsheetId);
        if (ticketsSpreadsheetId) clearCacheForSpreadsheet(ticketsSpreadsheetId);
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Route Error] walk-in:", error);
      if (error.message.includes("not found")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Transactional Check-in with optional Bid (e.g. for unpaid tickets)
  router.post("/auction/check-in-with-bid", async (req: Request, res: Response, next: NextFunction) => {
    const {
      bidderId, 
      spreadsheetId, 
      bidManagementSheet, 
      bidderNumbersSheet, 
      bidValue,
      idempotencyKey 
    } = req.body;

    if (!bidderId || !spreadsheetId || !bidManagementSheet || !bidderNumbersSheet || !bidValue) {
      return res.status(400).json({ error: "Missing required parameters for check-in with bid." });
    }

    try {
      const outcome = await withIdempotency("auction/check-in-with-bid", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const sheets = google.sheets({ version: "v4", auth: client });

        const result = await checkInBidderWithBid(sheets, {
          bidderId,
          spreadsheetId,
          bidManagementSheet,
          bidderNumbersSheet,
          bidValue
        });

        clearCacheForSpreadsheet(spreadsheetId);
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Route Error] check-in-with-bid:", error);
      if (error.message.includes("not found")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  return router;
}
