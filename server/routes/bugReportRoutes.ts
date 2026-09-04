import { Router, Request, Response, NextFunction } from "express";
import { google } from "googleapis";
import { getAuthenticatedClient } from "../services/oauth";
import { appendBugReportToSheet, buildReportFilename, deleteScreenshotFromDrive, findReportRow, listOpenBugReports, markReportResolved, uploadScreenshotToDrive, writeLocalReportFallback } from "../services/bugReportService";
import { requireAuth } from "../middleware/requireAuth";
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

  // Viewing/resolving reports is a real admin action against a real
  // spreadsheet, unlike submission above - gated behind the normal
  // session the same as every other data-reading route in this app.
  router.get("/list", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    const spreadsheetId = req.query.spreadsheetId as string;
    if (!spreadsheetId) {
      return res.status(400).json({ error: "spreadsheetId is required" });
    }

    try {
      const client = getAuthenticatedClient(req.session!.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });
      const reports = await listOpenBugReports(sheets, spreadsheetId);
      res.json({ reports });
    } catch (error: any) {
      if (error.code === 404) {
        return res.status(404).json({ error: "Bug Reports spreadsheet not found. Please check the ID in Settings." });
      }
      next(error);
    }
  });

  router.post("/resolve", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    const { spreadsheetId, reportId } = req.body;
    if (!spreadsheetId || !reportId) {
      return res.status(400).json({ error: "spreadsheetId and reportId are required" });
    }

    try {
      const client = getAuthenticatedClient(req.session!.tokens);
      const sheets = google.sheets({ version: "v4", auth: client });
      const { rowIndex, screenshotLink } = await findReportRow(sheets, spreadsheetId, reportId);
      if (rowIndex === -1) {
        return res.status(404).json({ error: "Report not found" });
      }
      await markReportResolved(sheets, spreadsheetId, rowIndex);
      if (screenshotLink) {
        const drive = google.drive({ version: "v3", auth: client });
        await deleteScreenshotFromDrive(drive, screenshotLink);
      }
      res.json({ success: true });
    } catch (error: any) {
      next(error);
    }
  });

  return router;
}
