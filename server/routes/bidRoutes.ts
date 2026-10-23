import { Router, Request, Response, NextFunction } from 'express';
import { getAuthenticatedClient } from '../services/oauth';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { registerWalkInBidder, checkInBidderWithBid, setBidderFlag, BIDDER_FLAG_COLUMNS } from '../services/bidderService';
import { recordWinningBid, checkoutMarkPaid, closeAuctionAndCleanup } from '../services/auctionService';
import { requireAuth } from '../middleware/requireAuth';
import { saveSpecialWinner, SPECIAL_PRIZES } from '../services/specialWinnerService';
import { getPaypalIsSandbox } from '../services/sharedConfig';
import { sheetsFor } from '../utils/googleClients';

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
      itemsSpreadsheetId,
      idempotencyKey 
    } = req.body;

    if (!bidderId || !itemId || !price || !spreadsheetId || !bidManagementSheet || !bidderNumbersSheet) {
      return res.status(400).json({ error: "Missing required fields for recording winning bid." });
    }

    // Found in a hardening audit (docs/agents/CHANGELOG.md's
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
        const sheets = sheetsFor(req);

        const result = await recordWinningBid(sheets, {
          bidderId,
          itemId,
          price: numericPrice,
          spreadsheetId,
          bidManagementSheet,
          bidderNumbersSheet,
          itemsSpreadsheetId: typeof itemsSpreadsheetId === "string" && itemsSpreadsheetId ? itemsSpreadsheetId : undefined
        });

        clearCacheForSpreadsheet(spreadsheetId);
        return result;
        // Durable: a bid saved on a device while offline can be resent
        // hours later, after Cloud Run has restarted (Milestone A).
      }, { durable: true });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Route Error] record-winning-bid:", error);
      if (error.code === "conflict") {
        return res.status(409).json({ error: error.message });
      }
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
      bidManagementSheet,
      attendeeInfo,
      paymentMethod,
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
          bidManagementSheet,
          paymentMethod: paymentMethod || "cash",
          // From Firestore, never the request body (ROADMAP.md M3).
          paypalIsSandbox: await getPaypalIsSandbox(),
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
      const sheets = sheetsFor(req);

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
        const sheets = sheetsFor(req);

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

  // Dashboard: save the gift-card / raffle winner (plus a Follow-Up row if they already checked out)
  router.post("/auction/special-winner", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, prize, bidderId, addFollowUp, idempotencyKey } = req.body;
    if (!spreadsheetId || !Object.hasOwn(SPECIAL_PRIZES, prize) || typeof bidderId !== "string") {
      return res.status(400).json({ error: "Missing or invalid parameters for saving a special winner." });
    }

    try {
      const outcome = await withIdempotency("auction/special-winner", idempotencyKey, async () => {
        const sheets = sheetsFor(req);
        return saveSpecialWinner(sheets, { spreadsheetId, prize, bidderId: bidderId.trim(), addFollowUp: !!addFollowUp });
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Route Error] special-winner:", error);
      next(error);
    }
  });

  // Tick a bidder's Checked In or Proxy Bidder box (locked, like every Bidder-Numbers write)
  router.post("/bidders/set-flag", async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, bidderNumbersSheet, bidderId, flag } = req.body;
    if (!spreadsheetId || !bidderNumbersSheet || !bidderId || !Object.hasOwn(BIDDER_FLAG_COLUMNS, flag)) {
      return res.status(400).json({ error: "Missing or invalid parameters for setting a bidder flag." });
    }

    try {
      const sheets = sheetsFor(req);
      const result = await setBidderFlag(sheets, { spreadsheetId, bidderNumbersSheet, bidderId: String(bidderId), flag });
      clearCacheForSpreadsheet(spreadsheetId);
      res.json(result);
    } catch (error: any) {
      console.error("[Route Error] set-flag:", error);
      if (error.message?.includes("not found")) {
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

    // Same check as record-winning-bid's price (ROADMAP.md L4): a
    // non-numeric value would be stored as the ticket's price and then
    // invoiced as $0.
    const numericBidValue = typeof bidValue === "number" ? bidValue : parseFloat(bidValue);
    if (isNaN(numericBidValue) || !isFinite(numericBidValue)) {
      return res.status(400).json({ error: "bidValue must be a valid number." });
    }

    try {
      const outcome = await withIdempotency("auction/check-in-with-bid", idempotencyKey, async () => {
        const sheets = sheetsFor(req);

        const result = await checkInBidderWithBid(sheets, {
          bidderId,
          spreadsheetId,
          bidManagementSheet,
          bidderNumbersSheet,
          bidValue: numericBidValue
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
