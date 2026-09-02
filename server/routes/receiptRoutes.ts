import { Router } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../services/oauth';
import { processEmail } from '../services/emailService';
import { createIndividualReceipt, createAllReceipts, processAllEmails } from '../services/receiptService';

export default function createReceiptsRouter() {
  const router = Router();

  router.post("/generate", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { bidderId, emailReceipt } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    
    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const script = google.script({ version: "v1", auth: client });

      const result = await createIndividualReceipt(script, scriptId, bidderId, !!emailReceipt);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/generate-all", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    
    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const script = google.script({ version: "v1", auth: client });

      const result = await createAllReceipts(script, scriptId);
      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  });


  router.post("/email-all", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { spreadsheetId } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const sentCount = await processAllEmails(client, spreadsheetId);
      res.json({ success: true, sentCount });
    } catch (error) {
      next(error);
    }
  });

  router.post("/email-only", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { bidderId, spreadsheetId } = req.body;
    if (!spreadsheetId) return res.status(400).json({ error: "spreadsheetId required" });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const result = await processEmail(client, spreadsheetId, String(bidderId));

      if (!result.success) return res.status(400).json({ error: result.error });

      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
