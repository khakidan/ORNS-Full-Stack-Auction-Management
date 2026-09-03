import { Router, Request, Response, NextFunction } from 'express';
import { google } from 'googleapis';
import { getColumnLetter } from '../utils/columnUtils';
import { getAuthenticatedClient } from '../services/oauth';
import { checkIdempotency, saveIdempotency } from '../utils/idempotency';
import { executeGoogleSheetsTransaction, SheetOp } from '../services/sheetsService';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { registerWalkInBidder, checkInBidderWithBid } from '../services/bidderService';
import { recordWinningBid, checkoutMarkPaid, closeAuctionAndCleanup } from '../services/auctionService';

export default function createBidRouter() {
  const router = Router();

  // Record winning bid with follow-up logic
  router.post("/auction/record-winning-bid", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

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

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });

      const result = await recordWinningBid(sheets, {
        bidderId,
        itemId,
        price,
        spreadsheetId,
        bidManagementSheet,
        bidderNumbersSheet
      });

      clearCacheForSpreadsheet(spreadsheetId);

      saveIdempotency(idempotencyKey, result);
      res.json(result);
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
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { 
      bidderId, 
      spreadsheetId, 
      ticketsSpreadsheetId, 
      bidderNumbersSheet, 
      attendeeInfo,
      paymentMethod,
      idempotencyKey 
    } = req.body;

    if (!spreadsheetId || !bidderId || !bidderNumbersSheet) {
      return res.status(400).json({ error: "Missing required parameters for checkout" });
    }

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      
      const result = await checkoutMarkPaid(client, {
        bidderId: String(bidderId),
        spreadsheetId,
        ticketsSpreadsheetId,
        bidderNumbersSheet,
        paymentMethod: paymentMethod || "cash",
        attendeeInfo
      });

      clearCacheForSpreadsheet(spreadsheetId);
      if (ticketsSpreadsheetId) clearCacheForSpreadsheet(ticketsSpreadsheetId);

      saveIdempotency(idempotencyKey, result);
      
      if (result.deferred) {
        res.status(202).json({
          ...result,
          message: "Verification deferred",
          bidderId: String(bidderId)
        });
      } else {
        res.status(200).json(result);
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
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

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
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

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

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    try {
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

      saveIdempotency(idempotencyKey, result);
      res.json(result);
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
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

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

    const cached = checkIdempotency(req, res, idempotencyKey);
    if (cached) return;

    try {
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
      
      saveIdempotency(idempotencyKey, result);
      res.json(result);
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
