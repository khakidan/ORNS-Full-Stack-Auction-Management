import { Router, Request, Response, NextFunction } from "express";
import { google } from "googleapis";
import { getAuthenticatedClient } from "../services/oauth";
import { appendBugReportToSheet, buildReportFilename, deleteScreenshotFromDrive, findReportRow, listOpenBugReports, logReportFallback, markReportResolved, uploadScreenshotToDrive, writeLocalReportFallback } from "../services/bugReportService";
import { requireAuth } from "../middleware/requireAuth";
import { notifyAdminOfBugReport } from "../services/adminNotifications";
import { BugReportPayload, BugReportType } from "../../src/types";
import { sheetsFor, driveFor } from '../utils/googleClients';

const BUG_REPORT_TYPES: BugReportType[] = ["Bug", "UI Issue", "Workflow Issue"];
const MAX_TEXT_LENGTH = 50_000;
const MAX_CONSOLE_ENTRIES = 200;

/** Any client value as a string of at most MAX_TEXT_LENGTH characters. */
function capText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : "";
}

/** The client's timestamp re-serialized as ISO 8601, or now if it isn't a real date. */
function normalizeTimestamp(value: unknown): string {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

// Reports without a session: at most ANON_LIMIT per IP per ANON_WINDOW_MS.
// In-process, like this app's other state (see ROADMAP.md M4).
const ANON_LIMIT = 5;
const ANON_WINDOW_MS = 10 * 60 * 1000;
const anonymousReports = new Map<string, number[]>();

function allowAnonymousReport(ip: string, now = Date.now()): boolean {
  const recent = (anonymousReports.get(ip) || []).filter((t) => now - t < ANON_WINDOW_MS);
  if (recent.length >= ANON_LIMIT) {
    anonymousReports.set(ip, recent);
    return false;
  }
  recent.push(now);
  anonymousReports.set(ip, recent);
  if (anonymousReports.size > 10_000) anonymousReports.clear(); // bound memory under a spray of IPs
  return true;
}

/** Test-only: forget every anonymous-report timestamp. */
export function _resetBugReportRateLimitForTesting(): void {
  anonymousReports.clear();
}

export default function createBugReportRouter() {
  const router = Router();

  // Deliberately NOT gated by requireAuth, unlike every other router in
  // this app - a bug report about a broken or expired Google session
  // must still be savable even when req.session.tokens is missing or
  // stale. The catch block below falls back to the logs (production) or a
  // local file (development) in exactly that case, so an unauthenticated
  // request still succeeds.
  //
  // Because anyone can reach it (ROADMAP.md M1): requests without a
  // session are rate-limited per IP and can't attach a screenshot, every
  // text field is length-capped, and `type`/`timestamp` are validated
  // rather than written as sent.
  router.post("/", async (req: Request, res: Response) => {
    const { title, description, type, timestamp, route, appState, browserInfo, consoleActivity, screenshotBase64, bugReportsSpreadsheetId, bugReportsFolderId } = req.body;

    if (!title || !description || !type) {
      return res.status(400).json({ error: "Missing required fields: title, description, and type are required." });
    }
    if (!BUG_REPORT_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${BUG_REPORT_TYPES.join(", ")}.` });
    }

    const signedIn = !!req.session?.tokens;
    if (!signedIn && !allowAnonymousReport(req.ip || "unknown")) {
      return res.status(429).json({ error: "Too many bug reports from this address - please sign in, or try again in a few minutes." });
    }

    const report: BugReportPayload = {
      title: capText(title),
      description: capText(description),
      type,
      timestamp: normalizeTimestamp(timestamp),
      route: capText(route) || "(unknown)",
      appState: capText(appState),
      browserInfo: capText(browserInfo),
      consoleActivity: Array.isArray(consoleActivity)
        ? consoleActivity.slice(-MAX_CONSOLE_ENTRIES).map((e: any) => ({ level: e?.level === "warn" ? "warn" : "error", message: capText(e?.message), timestamp: capText(e?.timestamp) }))
        : [],
      screenshotBase64: signedIn && typeof screenshotBase64 === "string" && screenshotBase64 ? screenshotBase64 : null,
    };

    // Emails web-admin@orns.org once the report is saved (anywhere), so a
    // report can't arrive unnoticed. Never lets a notification problem
    // fail or re-run the save.
    const respondSaved = async (body: Record<string, unknown>) => {
      try {
        await notifyAdminOfBugReport(report, req.session?.tokens);
      } catch (e: any) {
        console.error("[BugReport] Notification step failed:", e?.message || e);
      }
      return res.json(body);
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
      return await respondSaved({ success: true, storage: "sheet" });
    } catch (error: any) {
      console.error("[BugReport] Sheet save failed, falling back:", error?.message || error);
      try {
        // Cloud Run's disk is in-memory and wiped on every instance
        // recycle, so production falls back to Cloud Logging instead.
        if (process.env.NODE_ENV === "production") {
          logReportFallback(report);
          return await respondSaved({ success: true, storage: "log" });
        }
        const { filePath } = await writeLocalReportFallback(report);
        return await respondSaved({ success: true, storage: "local", filePath });
      } catch (fallbackError: any) {
        console.error("[BugReport] Fallback also failed:", fallbackError);
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
      const sheets = sheetsFor(req);
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
      const sheets = sheetsFor(req);
      const { rowIndex, screenshotLink } = await findReportRow(sheets, spreadsheetId, reportId);
      if (rowIndex === -1) {
        return res.status(404).json({ error: "Report not found" });
      }
      await markReportResolved(sheets, spreadsheetId, rowIndex);
      if (screenshotLink) {
        await deleteScreenshotFromDrive(driveFor(req), screenshotLink);
      }
      res.json({ success: true });
    } catch (error: any) {
      next(error);
    }
  });

  return router;
}
