# Data & Integration Schemas

This document contains the structural definitions and schemas utilized for external API integrations, Google Sheets bindings, and Firestore collections in the **ORNS Charity Auction Manager**.

---

## 1. Google Sheets Column Mapping

The application relies on Google Sheets as its primary database. The following sheets must conform to these strict column-indexed formats:

### Sheet: 'Bidder-Numbers'
This sheet tracks all event registrations, active bidders, and their checkout/payment statuses. The full A-N header row lives in `server/utils/bidderNumbersHeaders.ts` and is written when the tab is built (`syncService.ts`'s `writeBidderNumbersSheet`); on a tab built before L-N existed, `ensureTrackingHeaders` fills in any blank L1/M1/N1 the first time checkout or a receipt email writes to those columns (never overwriting a header someone typed). Table verified against that code and every reader/writer of this sheet on 2026-10-21 (this replaces an older table that listed Phone/Ticket Type/Table Number/Status/Notes columns that don't exist).

| Column Index | Header | Type | Description |
|---|---|---|---|
| Column A | `ID` | Number | Unique bidder number (walk-ins get `max existing + 1`, starting above 100) |
| Column B | `First Name` | String | Guest first name |
| Column C | `Last Name` | String | Guest last name |
| Column D | `Email` | String | Email address for receipts, invoices, and contact |
| Column E | `Checked In` | Checkbox | `TRUE` once the bidder has checked in |
| Column F | `Proxy Bidder` | Checkbox | Bidder is bidding by proxy |
| Column G | `Checked Out` | Checkbox | `TRUE` once checkout completes (also set for non-winners on auction close) |
| Column H | `Paid` | Checkbox | `TRUE` once payment is confirmed |
| Column I | `Payment Method` | String | `Cash`, `Check`, `Credit Card / PayPal`, `PayPal Verification Pending`, or `Failed Verification - Follow Up Required` |
| **Column J** | `Invoice URL` | String | **Automated Field**: cached PayPal invoice checkout URL |
| **Column K** | `Invoiced Amount` | Number | **Automated Field**: invoice total including PayPal processing fees |
| **Column L** | `PayPal Pending Since` | String (ISO) | **Automated Field**: timestamp set when checkout defers to "PayPal Verification Pending"; read and cleared by the PayPal sweeper (`server/services/paypalSweeperJob.ts`) |
| **Column M** | `Receipt Emailed At` | String (ISO) | **Automated Field**: when this bidder's receipt was last emailed (`emailService.ts`'s `recordReceiptEmailed`) |
| **Column N** | `Receipt Emailed Invoice` | String | **Automated Field**: the invoice link that email carried. Email All skips a bidder whose Column N equals their current Column J, so a re-run never re-sends an unchanged receipt. Clear it to force a re-send |

### Sheet: 'Bug-Reports'

A separate, dedicated spreadsheet (its ID lives in `Config.bugReportsSpreadsheetId`, not the Bid-Management one) - the central catalog every in-app bug report (the floating button/Ctrl-Cmd-Shift-B dialog, `src/hooks/useBugReportState.ts`) writes to via `POST /api/bug-reports` (`server/routes/bugReportRoutes.ts`). See `AGENTS.md`'s "Bug Report Lifecycle" section for how to close one out once fixed.

| Column Index | Field Name | Type | Description |
|---|---|---|---|
| Column A | `Report ID` | String | Timestamp + slugified title + random suffix - unique per report, never reused |
| Column B | `Timestamp` | String (ISO) | When the report was submitted |
| Column C | `Status` | String | `Open` on creation; flip to `Fixed` once shipped (see lifecycle note) |
| Column D | `Type` | String | `Bug` / `UI Issue` / `Workflow Issue` |
| Column E | `Title` | String | User-entered summary |
| Column F | `Description` | String | User-entered detail |
| Column G | `Route` | String | Auto-captured `activeWorkflow`/`activeBidTab` at submit time |
| Column H | `App State` | String | Auto-captured bidder/item/attendee/winner counts, auction-closed flag, configured-spreadsheet flags |
| Column I | `Browser Info` | String | Auto-captured user-agent, platform, viewport size |
| Column J | `Recent Console Activity` | String | Last ~20 `console.error`/`warn` entries + uncaught errors (`src/lib/errorBuffer.ts`) at submit time |
| Column K | `Screenshot Link` | String | Google Drive view link (uploaded to `Config.bugReportsFolderId`), blank if no screenshot was captured/configured |

If the Sheets write itself fails (no spreadsheet configured, an expired/missing OAuth session, a Sheets API error), the server falls back to writing the report as a self-contained `.md` file (+ sibling `.png` if a screenshot was captured) under a gitignored local `bug-reports/` directory at the repo root, so a report is never silently lost.

---

## 2. Shared Config Schema (Cloud Firestore)

Firestore is utilized to synchronize system configuration, active operational paths, and spreadsheet links in real-time.

### Collection: `settings`

*   **Document ID**: `global`
*   **Fields** (verified directly against the real `Config` type consumed by
    `src/context/ConfigContext.tsx` on 2026-09-02 - this replaces a
    previous version of this section that listed fields, such as
    `activeSpreadsheetId`/`syncStatus`/`paypalSurchargePercentage`, that
    don't exist anywhere in the actual `Config` type):

    ```json
    {
      "auctionItemsSpreadsheetId": "string (Google Sheet ID)",
      "auctionTicketsSpreadsheetId": "string (Google Sheet ID)",
      "bidManagementSpreadsheetId": "string (Google Sheet ID)",
      "bidderNumbersSheet": "string (sheet/tab name, default 'Bidder-Numbers')",
      "bidManagementSheet": "string (sheet/tab name, default 'Bid-Management')",
      "paypalIsSandbox": "boolean (true = PayPal sandbox; false = live invoices to real bidders)",
      "receiptFolderId": "string (Google Drive folder ID)",
      "forPrintFolderId": "string (Google Drive folder ID)",
      "ornsLogoId": "string (Google Drive file ID)",
      "ticketPrice": "string (default '35')",
      "auctionItemsScriptId": "string (Apps Script deployment ID)",
      "auctionTicketsScriptId": "string (Apps Script deployment ID)",
      "bidManagementScriptId": "string (Apps Script deployment ID)",
      "bugReportsSpreadsheetId": "string (Google Sheet ID - see 'Bug-Reports' sheet above)",
      "bugReportsFolderId": "string (Google Drive folder ID for report screenshots, optional)",
      "updatedAt": "timestamp (server-set on save)",
      "updatedBy": "string (email of the saving admin)"
    }
    ```
*   On load, `ConfigContext.tsx` mirrors every field into `localStorage`
    (plus two legacy keys, `spreadsheetId` and `googleScriptId`) for
    components not yet reading from context directly. `saveConfig()`
    requires an authenticated Firebase user and rejects writes otherwise.

---

## 3. Transactional APIs & Surcharge Computations

All payment surcharge evaluations must be executed server-side.

*   **Implementation**: `calculatePayPalSurcharge` in `server/utils/financeUtils.ts` (percent rate 3.49%, flat fee $0.49). There is no standalone HTTP endpoint for it - it runs inside the receipt, email, and invoice paths (`receiptDataService.ts`, `emailService.ts`, `paypalService.ts`).
*   **Surcharge Formula**:
    $$\text{Total Paid} = \frac{\text{Subtotal} + \text{Flat Fee}}{1 - \text{Surcharge Percentage}}$$
    *Calculated via `PayPalService.calculatePayPalSurcharge` to ensure consistency between sheets logging and billing invoices.*
