import { Router } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { processEmail } from '../services/emailService';
import { createIndividualReceipt, createAllReceipts, processAllEmails } from '../services/receiptService';
import { buildBidderReceipt, buildAllBidderReceipts } from '../services/receiptDataService';
import { requireAuth } from '../middleware/requireAuth';

export default function createReceiptsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post("/generate", async (req, res, next) => {
    const { bidderId, emailReceipt, spreadsheetId, itemsSpreadsheetId } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;

    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);

      // Node resolves the bidder's winning items/total itself now (see
      // receiptDataService.ts) instead of Class_ReceiptManager.gs doing
      // it a second, independent way - see refactor-opportunities.md's
      // Code Hardening item #2 / CHANGELOG.md.
      const receiptResult = await buildBidderReceipt(client, spreadsheetId, itemsSpreadsheetId, String(bidderId));
      if (receiptResult.success === false) return res.status(400).json({ error: receiptResult.error });

      const script = google.script({ version: "v1", auth: client });
      const result = await createIndividualReceipt(script, scriptId, bidderId, !!emailReceipt, receiptResult.receipt);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/generate-all", async (req, res, next) => {
    const { spreadsheetId, itemsSpreadsheetId } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;

    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const receipts = await buildAllBidderReceipts(client, spreadsheetId, itemsSpreadsheetId);

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
