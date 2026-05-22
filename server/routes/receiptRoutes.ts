import { Router } from 'express';
import { google } from 'googleapis';
import { getAuthenticatedClient } from '../utils/auth';
import { processEmail } from '../services/emailService';

export default function createReceiptsRouter() {
  const router = Router();

  router.post("/generate", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { bidderId, emailReceipt, receiptFolderId } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    
    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const script = google.script({ version: "v1", auth: client });

      const response = await script.scripts.run({
        scriptId,
        requestBody: {
          function: "apiCreateIndividualReceipt",
          parameters: [String(bidderId), !!emailReceipt],
          devMode: true,
        },
      });

      if (response.data.error) throw new Error(response.data.error.message);
      
      const result: any = response.data.response?.result;
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/generate-all", async (req, res, next) => {
    if (!req.session?.tokens) return res.status(401).json({ error: "Unauthorized" });

    const { receiptFolderId } = req.body;
    const scriptId = process.env.SCRIPT_ID_BID_MANAGEMENT;
    
    if (!scriptId) return res.status(500).json({ error: "SCRIPT_ID_BID_MANAGEMENT not configured." });

    try {
      const client = getAuthenticatedClient(req.session.tokens);
      const script = google.script({ version: "v1", auth: client });

      const response = await script.scripts.run({
        scriptId,
        requestBody: {
          function: "apiCreateAllReceipts",
          parameters: [],
          devMode: true,
        },
      });

      if (response.data.error) throw new Error(response.data.error.message);
      
      const result: any = response.data.response?.result;
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
      const sheets = google.sheets({ version: "v4", auth: client });
      
      const bNum = await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Bidder-Numbers'!A:L" });
      const numData = bNum.data.values || [];
      let sentCount = 0;
      
      for (let i = 1; i < numData.length; i++) {
        const id = String(numData[i][0] || "").trim();
        const email = String(numData[i][3] || "").trim();
        if (id && email) {
          const r = await processEmail(client, spreadsheetId, id);
          if (r.success) sentCount++;
        }
      }

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
