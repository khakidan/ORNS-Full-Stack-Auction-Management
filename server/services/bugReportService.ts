import { drive_v3, sheets_v4 } from "googleapis";
import fsPromises from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { sanitizeForSheetFormula } from "../utils/sheetFormula";
import { BugReportListItem, BugReportPayload } from "../../src/types";

/** Column order the whole module writes/reads Bug-Reports rows in - see appendBugReportToSheet below for the write side. */
const BUG_REPORTS_RANGE = "Bug-Reports!A:K";

// Gitignored, sibling to `sessions/` - a local, per-machine working note,
// not something that belongs in version control.
const LOCAL_FALLBACK_DIR = path.join(process.cwd(), "bug-reports");

/**
 * Builds a stable, unique base filename for one report - both the local
 * fallback .md/.png pair and the Sheet row's Report ID use this. Includes
 * seconds plus a short random suffix, not just an hours:minutes
 * timestamp: two reports submitted close together with a similar title
 * would otherwise silently overwrite each other on disk with no warning.
 */
export function buildReportFilename(report: Pick<BugReportPayload, "timestamp" | "title">): string {
  const safeTimestamp = report.timestamp.replace(/[:.]/g, "-");
  const slug = report.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 50) || "untitled";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${safeTimestamp}-${slug}-${suffix}`;
}

function formatConsoleActivityForFile(entries: BugReportPayload["consoleActivity"]): string {
  if (entries.length === 0) return "(none captured)";
  return entries.map((e) => `- [${e.timestamp}] **${e.level.toUpperCase()}**: ${e.message}`).join("\n");
}

export function buildReportMarkdown(report: BugReportPayload, screenshotFilename: string | null): string {
  const screenshotSection = screenshotFilename ? `\n![Screenshot](./${screenshotFilename})\n` : "";
  return `# ${report.title}

**Type:** ${report.type}
**Timestamp:** ${report.timestamp}
**Route:** ${report.route}

## App State
\`\`\`
${report.appState}
\`\`\`

## Browser Info
\`\`\`
${report.browserInfo}
\`\`\`
${screenshotSection}
## Description

${report.description}

## Recent Console Activity

${formatConsoleActivityForFile(report.consoleActivity)}
`;
}

/**
 * The resilience fallback: only reached when the primary Google Sheets
 * save (bugReportRoutes.ts) fails for any reason - no spreadsheet
 * configured, an expired/missing OAuth session, a Sheets API error.
 * Writes one self-contained .md file per report (+ a sibling .png if a
 * screenshot was captured), so a report is never silently lost even when
 * the cloud catalog is unreachable. Local development only - production
 * uses logReportFallback below instead.
 */
export async function writeLocalReportFallback(report: BugReportPayload): Promise<{ filePath: string; screenshotPath: string | null }> {
  await fsPromises.mkdir(LOCAL_FALLBACK_DIR, { recursive: true });
  const baseName = buildReportFilename(report);

  let screenshotFilename: string | null = null;
  if (report.screenshotBase64) {
    screenshotFilename = `${baseName}.png`;
    await fsPromises.writeFile(path.join(LOCAL_FALLBACK_DIR, screenshotFilename), Buffer.from(report.screenshotBase64, "base64"));
  }

  const filePath = path.join(LOCAL_FALLBACK_DIR, `${baseName}.md`);
  await fsPromises.writeFile(filePath, buildReportMarkdown(report, screenshotFilename));

  return { filePath, screenshotPath: screenshotFilename ? path.join(LOCAL_FALLBACK_DIR, screenshotFilename) : null };
}

/**
 * The production fallback (ROADMAP.md M1): Cloud Run's filesystem is
 * in-memory and wiped whenever an instance recycles, so a "local file"
 * there is neither durable nor safe (every anonymous 5 MB request would
 * eat instance RAM). Instead the report's text goes to Cloud Logging as
 * one structured entry - kept for the project's log retention period and
 * searchable by `jsonPayload.bugReport`. The screenshot is left out.
 */
export function logReportFallback(report: BugReportPayload): void {
  const { screenshotBase64, ...text } = report;
  console.error(JSON.stringify({
    severity: "ERROR",
    message: `[BugReport] Saved to logs (Sheet unavailable): ${report.title}`,
    bugReport: { ...text, consoleActivity: formatConsoleActivityForFile(report.consoleActivity), screenshotOmitted: !!screenshotBase64 },
  }));
}

export async function uploadScreenshotToDrive(drive: drive_v3.Drive, folderId: string, screenshotBase64: string, filename: string): Promise<string> {
  const buffer = Buffer.from(screenshotBase64, "base64");
  const res = await drive.files.create({
    requestBody: { name: filename, mimeType: "image/png", parents: [folderId] },
    media: { mimeType: "image/png", body: Readable.from(buffer) },
    fields: "id",
    supportsAllDrives: true,
  });
  return `https://drive.google.com/file/d/${res.data.id}/view`;
}

export async function appendBugReportToSheet(sheets: sheets_v4.Sheets, spreadsheetId: string, report: BugReportPayload, reportId: string, screenshotLink: string): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: BUG_REPORTS_RANGE,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        sanitizeForSheetFormula(reportId),
        sanitizeForSheetFormula(report.timestamp),
        "Open",
        sanitizeForSheetFormula(report.type),
        sanitizeForSheetFormula(report.title),
        sanitizeForSheetFormula(report.description),
        sanitizeForSheetFormula(report.route),
        sanitizeForSheetFormula(report.appState),
        sanitizeForSheetFormula(report.browserInfo),
        sanitizeForSheetFormula(formatConsoleActivityForFile(report.consoleActivity)),
        screenshotLink,
      ]],
    },
  });
}

/** Maps one raw Bug-Reports row (Column A-K) to the shape the admin list view reads - the inverse of appendBugReportToSheet's column order above. */
export function parseReportRow(row: string[]): BugReportListItem {
  return {
    reportId: row[0] || "",
    timestamp: row[1] || "",
    status: row[2] || "",
    type: row[3] || "",
    title: row[4] || "",
    description: row[5] || "",
    route: row[6] || "",
    appState: row[7] || "",
    browserInfo: row[8] || "",
    consoleActivity: row[9] || "",
    screenshotLink: row[10] || "",
  };
}

export async function listOpenBugReports(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<BugReportListItem[]> {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: BUG_REPORTS_RANGE });
  const rows = (result.data.values || []).slice(1); // drop the header row
  return rows
    .map(parseReportRow)
    .filter((r) => r.reportId && r.status.toLowerCase() === "open");
}

/**
 * Finds a report's 1-indexed sheet row by Report ID (column A), the same
 * find-by-key-in-column-A pattern - reading the full row (not
 * just column A) so the caller also gets the screenshot link back
 * without a second API call, since resolving a report needs both the
 * row index (to update Status) and the screenshot link (to delete the
 * Drive file) in the same request. rowIndex is -1 if not found.
 */
export async function findReportRow(sheets: sheets_v4.Sheets, spreadsheetId: string, reportId: string): Promise<{ rowIndex: number; screenshotLink: string }> {
  const result = await sheets.spreadsheets.values.get({ spreadsheetId, range: BUG_REPORTS_RANGE });
  const rows = result.data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === reportId) {
      return { rowIndex: i + 1, screenshotLink: rows[i][10] || "" };
    }
  }
  return { rowIndex: -1, screenshotLink: "" };
}

export async function markReportResolved(sheets: sheets_v4.Sheets, spreadsheetId: string, rowIndex: number): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `Bug-Reports!C${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [["Fixed"]] },
  });
}

/**
 * Deletes a report's screenshot from Drive once it's been resolved, so
 * the Bug Screenshots folder doesn't accumulate images for reports
 * that are done being worked on. Parses the file ID out of the
 * "https://drive.google.com/file/d/<id>/view" link uploadScreenshotToDrive
 * builds. Best-effort and non-blocking by design, matching this app's
 * other Drive/Sheets side effects (e.g. the screenshot upload itself) -
 * a resolved report must not fail to save just because Drive cleanup
 * didn't work, so failures are logged and swallowed, never thrown.
 *
 * `supportsAllDrives: true` is required here the same way
 * uploadScreenshotToDrive's create call already requires it - the Bug
 * Screenshots folder lives in a Shared Drive, and the Drive API rejects
 * (403/404) any operation against a file in a Shared Drive that omits
 * this flag, delete included. Without it, this silently failed on every
 * real resolve - swallowed by the catch above, so the report still
 * marked "Fixed" successfully while its screenshot was quietly never
 * deleted, with no visible error anywhere.
 */
export async function deleteScreenshotFromDrive(drive: drive_v3.Drive, screenshotLink: string): Promise<void> {
  const match = screenshotLink.match(/\/file\/d\/([^/]+)\//);
  if (!match) return;
  try {
    await drive.files.delete({ fileId: match[1], supportsAllDrives: true });
  } catch (error) {
    console.error("[BugReport] Failed to delete resolved report's screenshot from Drive:", error);
  }
}
