import { drive_v3, sheets_v4 } from "googleapis";
import fsPromises from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { BugReportPayload } from "../../src/types";

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
 * the cloud catalog is unreachable.
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
    range: "Bug-Reports!A:K",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        reportId,
        report.timestamp,
        "Open",
        report.type,
        report.title,
        report.description,
        report.route,
        report.appState,
        report.browserInfo,
        formatConsoleActivityForFile(report.consoleActivity),
        screenshotLink,
      ]],
    },
  });
}
