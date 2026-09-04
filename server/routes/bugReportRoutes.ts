import { Router, Request, Response } from "express";
import { google } from "googleapis";
import { getAuthenticatedClient } from "../services/oauth";
import { appendBugReportToSheet, buildReportFilename, uploadScreenshotToDrive, writeLocalReportFallback } from "../services/bugReportService";
import { BugReportPayload } from "../../src/types";

export default function createBugReportRouter() {
  const router = Router();

  // Deliberately NOT gated by requireAuth, unlike every other router in
  // this app - a bug report about a broken or expired Google session
  // must still be savable even when req.session.tokens is missing or
  // stale. The catch block below falls back to a local file in exactly
  // that case, so an unauthenticated request still succeeds.
  router.post("/", async (req: Request, res: Response) => {
    const { title, description, type, timestamp, route, appState, browserInfo, consoleActivity, screenshotBase64, bugReportsSpreadsheetId, bugReportsFolderId } = req.body;

    if (!title || !description || !type) {
      return res.status(400).json({ error: "Missing required fields: title, description, and type are required." });
    }

    const report: BugReportPayload = {
      title,
      description,
      type,
      timestamp: timestamp || new Date().toISOString(),
      route: route || "(unknown)",
      appState: appState || "",
      browserInfo: browserInfo || "",
      consoleActivity: Array.isArray(consoleActivity) ? consoleActivity : [],
      screenshotBase64: screenshotBase64 || null,
    };

    try {
      if (!bugReportsSpreadsheetId) {
        throw new Error("No Bug Reports spreadsheet configured");
      }

      const client = getAuthenticatedClient(req.session?.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });
      const reportId = buildReportFilename(report);

      let screenshotLink = "";
      if (report.screenshotBase64 && bugReportsFolderId) {
        const drive = google.drive({ version: "v3", auth: client });
        screenshotLink = await uploadScreenshotToDrive(drive, bugReportsFolderId, report.screenshotBase64, `${reportId}.png`);
      }

      await appendBugReportToSheet(sheets, bugReportsSpreadsheetId, report, reportId, screenshotLink);
      return res.json({ success: true, storage: "sheet" });
    } catch (error: any) {
      console.error("[BugReport] Sheet save failed, falling back to a local file:", error);
      try {
        const { filePath } = await writeLocalReportFallback(report);
        return res.json({ success: true, storage: "local", filePath });
      } catch (fallbackError: any) {
        console.error("[BugReport] Local fallback also failed:", fallbackError);
        return res.status(500).json({ error: "Failed to save bug report" });
      }
    }
  });

  return router;
}
