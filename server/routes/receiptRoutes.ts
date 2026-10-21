import { Router } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { processEmail } from '../services/emailService';
import { createIndividualReceipt, createAllReceipts, processAllEmails } from '../services/receiptService';
import { buildBidderReceiptWithInvoice, buildAllBidderReceiptsWithInvoices } from '../services/receiptDataService';
import { PayPalService } from '../services/paypalService';
import { requireAuth } from '../middleware/requireAuth';
import { withLock } from '../utils/asyncLock';
import { withIdempotency, idempotentBody } from '../utils/idempotency';

export default function createReceiptsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post("/generate", async (req, res, next) => {
    const { bidderId, spreadsheetId, itemsSpreadsheetId, paypalIsSandbox } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;

    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);

      // Node resolves the bidder's winning items/total AND their PayPal
      // invoice itself now (see receiptDataService.ts) instead of
      // Class_ReceiptManager.gs doing either a second, independent way -
      // see refactor-opportunities.md's Code Hardening item #2 /
      // CHANGELOG.md. `paypalIsSandbox` defaults to sandbox (true) unless
      // explicitly set to false by the client's Config toggle - a missing
      // value must never accidentally mean production.
      const paypal = new PayPalService({ isSandbox: paypalIsSandbox !== false });
      // Same lock key checkoutMarkPaid holds while it creates invoices
      // (ROADMAP.md H1): without it, a receipt and a checkout for the same
      // bidder - or a client retry of this route - could each see "no
      // invoice yet" and both create and send one.
      const receiptResult = await withLock(`bidder-numbers:${spreadsheetId}`, () =>
        buildBidderReceiptWithInvoice(client, spreadsheetId, itemsSpreadsheetId, String(bidderId), paypal)
      );
      if (receiptResult.success === false) return res.status(400).json({ error: receiptResult.error });

      const script = google.script({ version: "v1", auth: client });
      const result = await createIndividualReceipt(script, scriptId, bidderId, receiptResult.receipt);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/generate-all", async (req, res, next) => {
    const { spreadsheetId, itemsSpreadsheetId, paypalIsSandbox } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;

    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const paypal = new PayPalService({ isSandbox: paypalIsSandbox !== false });
      // See /generate above - a retried or concurrent run now waits here,
      // then reuses the invoices the first run already saved to J/K.
      const receipts = await withLock(`bidder-numbers:${spreadsheetId}`, () =>
        buildAllBidderReceiptsWithInvoices(client, spreadsheetId, itemsSpreadsheetId, paypal)
      );

      const script = google.script({ version: "v1", auth: client });
      const result = await createAllReceipts(script, scriptId, receipts);
      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  });


  // Emailing resolves each bidder's PayPal invoice (ROADMAP.md H2), so,
  // like /generate, these routes need `paypalIsSandbox` - and default to
  // sandbox unless the client's Config toggle explicitly says false.
  router.post("/email-all", async (req, res, next) => {
    const { spreadsheetId, itemsSpreadsheetId, paypalIsSandbox, idempotencyKey } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const outcome = await withIdempotency("receipts/email-all", idempotencyKey, async () => {
        const client = getAuthenticatedClient(req.session.tokens);
        const paypal = new PayPalService({ isSandbox: paypalIsSandbox !== false });
        const result = await processAllEmails(client, spreadsheetId, itemsSpreadsheetId, paypal);
        return { success: true, ...result };
      });
      res.json(idempotentBody(outcome));
    } catch (error) {
      next(error);
    }
  });

  router.post("/email-only", async (req, res, next) => {
    const { bidderId, spreadsheetId, itemsSpreadsheetId, paypalIsSandbox } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const paypal = new PayPalService({ isSandbox: paypalIsSandbox !== false });
      const result = await processEmail(client, spreadsheetId, String(bidderId), itemsSpreadsheetId, paypal);

      if (result.success === false) return res.status(400).json({ error: result.error });

      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
