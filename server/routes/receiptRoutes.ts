import { Router } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { processEmail } from '../services/emailService';
import { createIndividualReceipt, createAllReceipts, processAllEmails } from '../services/receiptService';
import { buildBidderReceiptWithInvoice, buildAllBidderReceiptsWithInvoices } from '../services/receiptDataService';
import { PayPalService } from '../services/paypalService';
import { requireAuth } from '../middleware/requireAuth';

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
      const receiptResult = await buildBidderReceiptWithInvoice(client, spreadsheetId, itemsSpreadsheetId, String(bidderId), paypal);
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
      const receipts = await buildAllBidderReceiptsWithInvoices(client, spreadsheetId, itemsSpreadsheetId, paypal);

      const script = google.script({ version: "v1", auth: client });
      const result = await createAllReceipts(script, scriptId, receipts);
      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  });


  router.post("/email-all", async (req, res, next) => {
    const { spreadsheetId, itemsSpreadsheetId } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sentCount = await processAllEmails(client, spreadsheetId, itemsSpreadsheetId);
      res.json({ success: true, sentCount });
    } catch (error) {
      next(error);
    }
  });

  router.post("/email-only", async (req, res, next) => {
    const { bidderId, spreadsheetId, itemsSpreadsheetId } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const result = await processEmail(client, spreadsheetId, String(bidderId), itemsSpreadsheetId);

      if (!result.success) return res.status(400).json({ error: result.error });

      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
