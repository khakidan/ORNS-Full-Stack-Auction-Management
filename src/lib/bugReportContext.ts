import { BugReportConsoleEntry, BugReportListItem } from "@/types";

export interface AppStateSnapshot {
  biddersCount: number;
  itemsCount: number;
  attendeesCount: number;
  winnersCount: number;
  isAuctionClosed: boolean;
  bidManagementSpreadsheetConfigured: boolean;
  auctionItemsSpreadsheetConfigured: boolean;
  auctionTicketsSpreadsheetConfigured: boolean;
}

/**
 * Renders the auction/config-derived "what was the app doing" snapshot
 * into the compact text block that lands in the report's App State cell -
 * kept separate from the Config-ID/count gathering itself (done by the
 * caller, which has the real context/hook values) so this stays a pure,
 * directly testable formatter.
 */
export function formatAppState(state: AppStateSnapshot): string {
  return [
    `Bidders: ${state.biddersCount}`,
    `Items: ${state.itemsCount}`,
    `Attendees: ${state.attendeesCount}`,
    `Winners recorded: ${state.winnersCount}`,
    `Auction closed: ${state.isAuctionClosed}`,
    `Bid Management spreadsheet configured: ${state.bidManagementSpreadsheetConfigured}`,
    `Auction Items spreadsheet configured: ${state.auctionItemsSpreadsheetConfigured}`,
    `Auction Tickets spreadsheet configured: ${state.auctionTicketsSpreadsheetConfigured}`,
  ].join("\n");
}

/**
 * The current "route" in this app's own terms - App.tsx has no router,
 * just activeWorkflow/activeBidTab state mirrored into localStorage on
 * every change (see App.tsx's two `localStorage.setItem` effects), so
 * reading those two keys directly is the real, already-in-sync signal
 * for "what page was the user looking at" without threading new state
 * through the provider tree.
 */
export function getCurrentRoute(): string {
  const workflow = localStorage.getItem("activeWorkflow") || "unknown";
  const bidTab = localStorage.getItem("activeBidTab");
  const path = window.location.pathname || "/";
  return bidTab && workflow === "bids" ? `${path} (workflow: ${workflow}, tab: ${bidTab})` : `${path} (workflow: ${workflow})`;
}

export function formatBrowserInfo(): string {
  return [
    `User-Agent: ${navigator.userAgent}`,
    `Platform: ${navigator.platform}`,
    `Viewport: ${window.innerWidth}x${window.innerHeight}`,
  ].join("\n");
}

export function formatConsoleActivity(entries: BugReportConsoleEntry[]): string {
  if (entries.length === 0) return "(none captured)";
  return entries.map((e) => `[${e.timestamp}] ${e.level.toUpperCase()}: ${e.message}`).join("\n");
}

/**
 * Renders one already-fetched report row (BugReportsAdmin.tsx's "View"
 * dialog) back out as a single self-contained Markdown document, meant
 * to be copied and pasted straight into a chat with a coding assistant -
 * mirrors bugReportService.ts's server-side buildReportMarkdown's
 * section structure (Type/Timestamp/Route header block, App State/
 * Browser Info as fenced code blocks, Description, then Recent Console
 * Activity) so the two "shapes" of this app's bug reports stay
 * recognizably the same document, just from two different sources - one
 * built at submit time from live app state, this one rebuilt at review
 * time from what's already in the sheet. The screenshot (if any) is a
 * plain Markdown link to the real Drive file, not a re-embedded image -
 * there's no local file to link to here, unlike the local-fallback path.
 */
export function formatReportAsMarkdown(report: BugReportListItem): string {
  const screenshotLine = report.screenshotLink ? `\n**Screenshot:** ${report.screenshotLink}\n` : "";
  return `# ${report.title}

**Type:** ${report.type}
**Status:** ${report.status}
**Timestamp:** ${report.timestamp}
**Route:** ${report.route}
${screenshotLine}
## Description

${report.description}

## App State
\`\`\`
${report.appState}
\`\`\`

## Browser Info
\`\`\`
${report.browserInfo}
\`\`\`

## Recent Console Activity

${report.consoleActivity}
`;
}
