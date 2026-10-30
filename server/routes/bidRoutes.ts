import { Router, Request, Response, NextFunction } from 'express';
import { fromConfig, BID_MANAGEMENT_FIELDS } from '../middleware/fromConfig';
import { requirePermission } from '../middleware/requirePermission';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { clearCacheForSpreadsheet } from '../utils/sheetCache';
import { registerWalkInBidder, checkInBidderWithBid, setBidderFlag, BIDDER_FLAG_COLUMNS } from '../services/bidderService';
import { recordWinningBid, checkoutMarkPaid, closeAuctionAndCleanup, goLiveAuction, AuctionStateError } from '../services/auctionService';
import { requireAuth } from '../middleware/requireAuth';
import { saveSpecialWinner, SPECIAL_PRIZES } from '../services/specialWinnerService';
import { getPaypalIsSandbox } from '../services/sharedConfig';
import { sheetsFor, googleAuthFor } from '../utils/googleClients';
import { logAction } from '../services/actionLog';
import { deactivateAllVolunteers, forgetAuctionState } from '../services/volunteerService';
import { syncBiddersFromTickets } from '../services/bidderTicketSync';
import type { CheckInWithBidRequest, CheckoutMarkPaidRequest, CloseAuctionRequest, GoLiveRequest, RecordWinningBidRequest, SetBidderFlagRequest, SpecialWinnerRequest, WalkInRequest } from "../../shared/apiTypes";

export default function createBidRouter() {
  const router = Router();
  router.use(requireAuth);

  // Record winning bid with follow-up logic
  router.post("/auction/record-winning-bid", fromConfig(BID_MANAGEMENT_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const {
      bidderId, 
      itemId, 
      price, 
      spreadsheetId, 
      bidManagementSheet, 
      bidderNumbersSheet,
      itemsSpreadsheetId,
      idempotencyKey 
    } = req.body as RecordWinningBidRequest;

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
        if (!result.alreadyRecorded && result.range) {
          await logAction(req, {
            area: "Bid Management",
            action: "Record winning bid",
            target: `Item ${itemId}`,
            summary: `Bidder ${bidderId} won item ${itemId} for $${numericPrice.toFixed(2)}${result.followUpAdded ? " (already checked out - added to Follow-Up)" : ""}`,
            after: { bidderId, itemId, price: numericPrice },
            location: `Bid Management ${result.range}`,
            undo: { kind: "cells", spreadsheetId, range: result.range, before: [["", ""]], after: [[itemId, numericPrice]], lock: `bidder-numbers:${spreadsheetId}` },
          });
        }
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
  router.post("/auction/checkout-mark-paid", fromConfig(BID_MANAGEMENT_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
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
    } = req.body as CheckoutMarkPaidRequest;

    if (!spreadsheetId || !bidderId || !bidderNumbersSheet) {
      return res.status(400).json({ error: "Missing required parameters for checkout" });
    }

    try {
      // The invoice and receipt carry the bidder's name and email - make sure they match the ticket first.
      await syncBiddersFromTickets(req);
      const outcome = await withIdempotency("auction/checkout-mark-paid", idempotencyKey, async () => {
        const client = googleAuthFor(req);

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
        await logAction(req, {
          area: "Bid Management",
          action: result.deferred ? "Checkout (PayPal pending)" : "Checkout / mark paid",
          target: `Bidder ${bidderId}`,
          summary: `Checked out bidder ${bidderId} by ${paymentMethod || "cash"}${result.deferred ? " - PayPal payment not confirmed yet" : ""}`,
          after: { paymentMethod: paymentMethod || "cash", deferred: !!result.deferred },
          notUndoableReason: "payments and PayPal invoices are handled outside the app",
        });
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

  router.post("/auction/go-live", requirePermission("auction.stage"), fromConfig(BID_MANAGEMENT_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId } = req.body as GoLiveRequest;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "Missing the Bid Management spreadsheet ID." });
    }

    try {
      const result = await goLiveAuction(sheetsFor(req), { spreadsheetId });
      clearCacheForSpreadsheet(spreadsheetId);
      forgetAuctionState();
      await logAction(req, { area: "Bid Management", action: "Go Live", summary: "Took the auction Live", notUndoableReason: "the auction only moves forward; go back to Prep by editing Auction-Status!A2 by hand" });
      res.json(result);
    } catch (error: any) {
      console.error("[Route Error] go-live:", error);
      if (error instanceof AuctionStateError) {
        return res.status(409).json({ error: error.message });
      }
      next(error);
    }
  });

  router.post("/auction/close-and-cleanup", requirePermission("auction.stage"), fromConfig(BID_MANAGEMENT_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, bidderNumbersSheet, bidManagementSheet } = req.body as CloseAuctionRequest;
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
      forgetAuctionState();
      // Volunteers' access ends with the auction. requireAuth's Live check
      // would end it within 30 seconds anyway; this makes it immediate and
      // records why on each volunteer.
      const volunteersEnded = await deactivateAllVolunteers("auction_closed").catch((e) => {
        console.error("[Volunteers] Couldn't deactivate volunteers on close:", e);
        return 0;
      });
      await logAction(req, {
        area: "Bid Management",
        action: "Close auction",
        summary: `Closed the auction, checked out ${result.count} bidder(s) who won nothing, and ended ${volunteersEnded} volunteer(s)' access`,
        notUndoableReason: "the auction only moves forward; reopen it by editing Auction-Status!A2 by hand",
      });

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
  /**
   * Brings every bidder's name and email in line with their ticket, and in
   * Prep adds anyone new on the tickets (bidderTicketSync.ts). The Bid Management page asks when it loads; it
   * also runs after ticket changes and before receipts and checkout.
   */
  router.post("/bidders/sync-from-tickets", async (req: Request, res: Response) => {
    const { renamed, added, unlinked } = await syncBiddersFromTickets(req);
    res.json({ renamed: renamed.length, added: added.length, unlinked });
  });

  router.post("/bidders/walk-in", requirePermission("bidders.walkIn"), fromConfig(BID_MANAGEMENT_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
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
    } = req.body as WalkInRequest;

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
        await logAction(req, {
          area: "Bid Management",
          action: "Register walk-in",
          target: result.bidder ? `Bidder ${result.bidder.id}` : undefined,
          summary: `Registered walk-in ${firstName} ${lastName}${result.bidder ? ` as bidder ${result.bidder.id}` : ""}`,
          after: { firstName, lastName, email, ticketPrice },
          notUndoableReason: "a walk-in adds a ticket, a bidder and a bid sheet column together",
        });
        // Ties the new bidder to the ticket just added.
        if (result.ticketAppended) await syncBiddersFromTickets(req);
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
  router.post("/auction/special-winner", fromConfig(BID_MANAGEMENT_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, prize, bidderId, addFollowUp, idempotencyKey } = req.body as SpecialWinnerRequest;
    if (!spreadsheetId || !Object.hasOwn(SPECIAL_PRIZES, prize) || typeof bidderId !== "string") {
      return res.status(400).json({ error: "Missing or invalid parameters for saving a special winner." });
    }

    try {
      const outcome = await withIdempotency("auction/special-winner", idempotencyKey, async () => {
        const sheets = sheetsFor(req);
        const winner = bidderId.trim();
        const result = await saveSpecialWinner(sheets, { spreadsheetId, prize, bidderId: winner, addFollowUp: !!addFollowUp });
        await logAction(req, {
          area: "Bid Management",
          action: "Set special winner",
          target: SPECIAL_PRIZES[prize as keyof typeof SPECIAL_PRIZES].itemName,
          summary: winner ? `${SPECIAL_PRIZES[prize as keyof typeof SPECIAL_PRIZES].itemName} winner: bidder ${winner}` : `Cleared the ${SPECIAL_PRIZES[prize as keyof typeof SPECIAL_PRIZES].itemName} winner`,
          before: result.before || undefined,
          after: winner || undefined,
          location: `Bid Management ${result.range}`,
          undo: { kind: "cells", spreadsheetId, range: result.range, before: [[result.before]], after: [[winner]], lock: `bidder-numbers:${spreadsheetId}` },
        });
        return result;
      });
      res.json(idempotentBody(outcome));
    } catch (error: any) {
      console.error("[Route Error] special-winner:", error);
      next(error);
    }
  });

  // Tick a bidder's Checked In or Proxy Bidder box (locked, like every Bidder-Numbers write)
  router.post("/bidders/set-flag", fromConfig(BID_MANAGEMENT_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, bidderNumbersSheet, bidderId, flag } = req.body as SetBidderFlagRequest;
    if (!spreadsheetId || !bidderNumbersSheet || !bidderId || !Object.hasOwn(BIDDER_FLAG_COLUMNS, flag)) {
      return res.status(400).json({ error: "Missing or invalid parameters for setting a bidder flag." });
    }

    try {
      const sheets = sheetsFor(req);
      const result = await setBidderFlag(sheets, { spreadsheetId, bidderNumbersSheet, bidderId: String(bidderId), flag });
      clearCacheForSpreadsheet(spreadsheetId);
      await logAction(req, {
        area: "Bid Management",
        action: flag === "checkedIn" ? "Check in" : "Mark proxy bidder",
        target: `Bidder ${bidderId}`,
        summary: flag === "checkedIn" ? `Checked in bidder ${bidderId}` : `Marked bidder ${bidderId} as a proxy bidder`,
        before: result.before,
        after: true,
        location: `Bid Management ${result.range}`,
        undo: { kind: "cells", spreadsheetId, range: result.range, before: [[result.before]], after: [[true]], lock: `bidder-numbers:${spreadsheetId}` },
      });
      res.json({ success: result.success });
    } catch (error: any) {
      console.error("[Route Error] set-flag:", error);
      if (error.message?.includes("not found")) {
        return res.status(400).json({ error: error.message });
      }
      next(error);
    }
  });

  // Transactional Check-in with optional Bid (e.g. for unpaid tickets)
  router.post("/auction/check-in-with-bid", fromConfig(BID_MANAGEMENT_FIELDS), async (req: Request, res: Response, next: NextFunction) => {
    const {
      bidderId, 
      spreadsheetId, 
      bidManagementSheet, 
      bidderNumbersSheet, 
      bidValue,
      idempotencyKey 
    } = req.body as CheckInWithBidRequest;

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
        await logAction(req, {
          area: "Bid Management",
          action: "Check in with ticket payment",
          target: `Bidder ${bidderId}`,
          summary: `Checked in bidder ${bidderId} and recorded their $${numericBidValue.toFixed(2)} ticket on their bid sheet`,
          after: { bidValue: numericBidValue },
          notUndoableReason: "it checks in and records a ticket purchase together",
        });
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
