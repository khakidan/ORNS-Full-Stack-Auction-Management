import { Router } from 'express';
import { googleAuthFor } from '../utils/googleClients';
import { logAction } from '../services/actionLog';
import { google } from 'googleapis';
import { processEmail } from '../services/emailService';
import { createIndividualReceipt, createAllReceipts, processAllEmails, RECEIPTS_PER_PART, receiptPartFileName } from '../services/receiptService';
import { isAppsScriptFailure } from '../utils/appsScriptRun';
import { buildBidderReceiptWithInvoice, buildAllBidderReceiptsWithInvoices, sheetNamesFromBody } from '../services/receiptDataService';
import { PayPalService } from '../services/paypalService';
import { getPaypalIsSandbox } from '../services/sharedConfig';
import { requireAuth } from '../middleware/requireAuth';
import { AlreadyRunningError, runIfIdle, withLock } from '../utils/asyncLock';
import { withIdempotency, idempotentBody } from '../utils/idempotency';
import { syncBiddersFromTickets } from '../services/bidderTicketSync';

export default function createReceiptsRouter() {
  const router = Router();
  router.use(requireAuth);
  // Receipts and their emails carry bidders' names and email addresses -
  // bring them in line with the tickets first (bidderTicketSync.ts).
  router.use(async (req, _res, next) => {
    await syncBiddersFromTickets(req);
    next();
  });

  router.post("/generate", async (req, res, next) => {
    const { bidderId, spreadsheetId, itemsSpreadsheetId } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;

    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      // One run at a time per bidder: a double-click or a resent request
      // would otherwise make a second copy of the receipt PDF.
      await runIfIdle(`receipt:${spreadsheetId}:${bidderId}`, async () => {
        const client = googleAuthFor(req);

        // Node resolves the bidder's winning items/total AND their PayPal
        // invoice itself now (see receiptDataService.ts) instead of
        // Class_ReceiptManager.gs doing either a second, independent way -
        // see CHANGELOG.md's Code Hardening item #2 /
        // CHANGELOG.md. Sandbox vs. live comes from Firestore, never the
        // request body (ROADMAP.md M3 - see sharedConfig.ts).
        const paypal = new PayPalService({ isSandbox: await getPaypalIsSandbox() });
        // Same lock key checkoutMarkPaid holds while it creates invoices
        // (ROADMAP.md H1): without it, a receipt and a checkout for the same
        // bidder - or a client retry of this route - could each see "no
        // invoice yet" and both create and send one.
        const receiptResult = await withLock(`bidder-numbers:${spreadsheetId}`, () =>
          buildBidderReceiptWithInvoice(client, spreadsheetId, itemsSpreadsheetId, String(bidderId), paypal, sheetNamesFromBody(req.body))
        );
        if (receiptResult.success === false) return res.status(400).json({ error: receiptResult.error });

        const script = google.script({ version: "v1", auth: client });
        const result = await createIndividualReceipt(script, scriptId, bidderId, receiptResult.receipt);
        // The script reports its own failures as { success: false } -
        // passing that on as a 200 showed "Receipt Doc created!" for a
        // receipt that was never made.
        if (isAppsScriptFailure(result)) return res.status(400).json({ error: result.error || "The receipt couldn't be created." });
        await logAction(req, { area: "Bid Management", action: "Print receipt", target: `Bidder ${bidderId}`, summary: `Created bidder ${bidderId}'s receipt`, notUndoableReason: "receipts and emails have already gone out" });
        res.json({ success: true, ...result });
      });
    } catch (error) {
      if (error instanceof AlreadyRunningError) return res.status(409).json({ error: "This bidder's receipt is already being created. Wait a moment, then check the Receipts folder." });
      next(error);
    }
  });

  /**
   * Prints receipts for every bidder with winning items, one part
   * (RECEIPTS_PER_PART bidders, one PDF) per request. The client asks for
   * part 1, then 2, and so on up to `totalParts`, so each request finishes
   * well inside Apps Script's 6-minute limit and the client can show
   * progress and stop at the first failure.
   *
   * Every part rebuilds the full sorted list (invoices are already saved
   * after part 1, so this reuses them) and takes its own slice. A winning
   * bid recorded while printing can shift a bidder across a part
   * boundary - print after bidding closes.
   */
  router.post("/generate-all", async (req, res, next) => {
    const { spreadsheetId, itemsSpreadsheetId } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    const part = req.body.part === undefined ? 1 : Number(req.body.part);

    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });
    if (!Number.isInteger(part) || part < 1) return res.status(400).json({ error: "part must be a whole number, starting at 1" });

    try {
      await runIfIdle(`receipts-all:${spreadsheetId}`, async () => {
        const client = googleAuthFor(req);
        const paypal = new PayPalService({ isSandbox: await getPaypalIsSandbox() });
        // See /generate above - a concurrent run now waits here, then
        // reuses the invoices the first run already saved to J/K.
        const receipts = await withLock(`bidder-numbers:${spreadsheetId}`, () =>
          buildAllBidderReceiptsWithInvoices(client, spreadsheetId, itemsSpreadsheetId, paypal, { sheetNames: sheetNamesFromBody(req.body) })
        );

        const totalParts = Math.ceil(receipts.length / RECEIPTS_PER_PART);
        if (totalParts === 0) return res.json({ success: true, part: 0, totalParts: 0, bidderCount: 0 });
        if (part > totalParts) return res.status(400).json({ error: `There are only ${totalParts} part(s) to print.` });

        const slice = receipts.slice((part - 1) * RECEIPTS_PER_PART, part * RECEIPTS_PER_PART);
        const fileName = receiptPartFileName(part, totalParts, slice);
        const script = google.script({ version: "v1", auth: client });
        const result = await createAllReceipts(script, scriptId, slice, fileName);
        if (isAppsScriptFailure(result)) return res.status(400).json({ error: result.error || `${fileName} couldn't be created.` });
        await logAction(req, { area: "Bid Management", action: "Print all receipts", target: `Part ${part} of ${totalParts}`, summary: `Printed ${fileName} (${slice.length} bidder(s))`, notUndoableReason: "receipts and emails have already gone out" });

        res.json({ success: true, part, totalParts, bidderCount: receipts.length, fileName });
      });
    } catch (error) {
      if (error instanceof AlreadyRunningError) return res.status(409).json({ error: "Receipts are already printing. Wait for that to finish, then check the Receipts folder." });
      next(error);
    }
  });


  // Emailing resolves each bidder's PayPal invoice (ROADMAP.md H2), so,
  // like /generate, these routes need a PayPalService.
  router.post("/email-all", async (req, res, next) => {
    const { spreadsheetId, itemsSpreadsheetId, idempotencyKey } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const outcome = await withIdempotency("receipts/email-all", idempotencyKey, async () => {
        const client = googleAuthFor(req);
        const paypal = new PayPalService({ isSandbox: await getPaypalIsSandbox() });
        const result = await processAllEmails(client, spreadsheetId, itemsSpreadsheetId, paypal, sheetNamesFromBody(req.body));
        await logAction(req, { area: "Bid Management", action: "Email all receipts", summary: "Emailed receipts to every winning bidder not already sent theirs", after: result, notUndoableReason: "receipts and emails have already gone out" });
        return { success: true, ...result };
      });
      res.json(idempotentBody(outcome));
    } catch (error) {
      next(error);
    }
  });

  router.post("/email-only", async (req, res, next) => {
    const { bidderId, spreadsheetId, itemsSpreadsheetId } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = googleAuthFor(req);
      const paypal = new PayPalService({ isSandbox: await getPaypalIsSandbox() });
      const result = await processEmail(client, spreadsheetId, String(bidderId), itemsSpreadsheetId, paypal, sheetNamesFromBody(req.body));

      if (result.success === false) return res.status(400).json({ error: result.error });

      await logAction(req, { area: "Bid Management", action: "Email receipt", target: `Bidder ${bidderId}`, summary: `Emailed bidder ${bidderId}'s receipt`, notUndoableReason: "receipts and emails have already gone out" });
      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
