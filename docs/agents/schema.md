# Data & Integration Schemas

This document contains the structural definitions and schemas utilized for external API integrations, Google Sheets bindings, and Firestore collections in the **ORNS Charity Auction Manager**.

---

## 1. Google Sheets Column Mapping

The application relies on Google Sheets as its primary database. The following sheets must conform to these strict column-indexed formats:

### Sheet: 'Bidder-Numbers'
This sheet tracks all event registrations, active bidders, and their checkout/payment statuses. **Names follow the tickets:** the Auction Tickets spreadsheet is the source of truth for each bidder's name and email; B-D (and the Bid-Management grid's name row) are copies that `server/services/bidderTicketSync.ts` keeps in step, using Column O to know which ticket is whose. It runs after every ticket change made in the app, when Bid Management loads, before receipts, labels and checkout, and about once a minute while anyone on staff has the app open (catching edits made directly in the spreadsheet). Change a name or email on the ticket, not here - an edit here is put back to the ticket's. A bidder number never changes. While the auction is in Prep, someone new on the tickets (a later ticket, a guest switched to their own number) is added with the next number and a grid column pair. The full A-O header row lives in `server/utils/bidderNumbersHeaders.ts` and is written when the tab is built (`syncService.ts`'s `writeBidderNumbersSheet`); on a tab built before L-O existed, `ensureTrackingHeaders` fills in any blank L1-O1 the first time checkout or a receipt email writes to those columns (never overwriting a header someone typed). Table verified against that code and every reader/writer of this sheet on 2026-10-21 (this replaces an older table that listed Phone/Ticket Type/Table Number/Status/Notes columns that don't exist).

| Column Index | Header | Type | Description |
|---|---|---|---|
| Column A | `ID` | Number | Unique bidder number (walk-ins get `max existing + 1`, starting above 100) |
| Column B | `First Name` | String | First name (from their ticket; words typed all capitals or all lowercase are tidied, a typed mix like "McDonald" is kept - `bidderName` in `server/services/ticketPeople.ts`) |
| Column C | `Last Name` | String | Last name (same rule as B) |
| Column D | `Email` | String | Email address for receipts, invoices, and contact (from their ticket, lowercased) |
| Column E | `Checked In` | Checkbox | `TRUE` once the bidder has checked in |
| Column F | `Proxy Bidder` | Checkbox | Bidder is bidding by proxy |
| Column G | `Checked Out` | Checkbox | `TRUE` once checkout completes (also set for non-winners on auction close) |
| Column H | `Paid` | Checkbox | `TRUE` once payment is confirmed |
| Column I | `Payment Method` | String | `Cash`, `Check`, `Credit Card / PayPal`, `PayPal Verification Pending`, or `Failed Verification - Follow Up Required` |
| **Column J** | `Invoice URL` | String | **Automated Field**: cached PayPal invoice checkout URL |
| **Column K** | `Invoiced Amount` | Number | **Automated Field**: invoice total including PayPal processing fees. Not changed by a cash/check checkout, even though that removes the fee line from the PayPal invoice; a later receipt run compares K against the expected total to reuse the invoice. |
| **Column L** | `PayPal Pending Since` | String (ISO) | **Automated Field**: timestamp set when checkout defers to "PayPal Verification Pending"; read and cleared by the PayPal sweeper (`server/services/paypalSweeperJob.ts`) |
| **Column M** | `Receipt Emailed At` | String (ISO) | **Automated Field**: when this bidder's receipt was last emailed (`emailService.ts`'s `recordReceiptEmailed`) |
| **Column N** | `Receipt Emailed Invoice` | String | **Automated Field**: the invoice link that email carried. Email All skips a bidder whose Column N equals their current Column J, so a re-run never re-sends an unchanged receipt. Clear it to force a re-send |
| **Column O** | `Ticket` | String | **Automated Field**: where the bidder's ticket is - `tickets!12`, `staff tickets!4`, `sponsor tickets!3`, or `tickets!12#2` for guest 2 on row 12. Written by Set Up; filled in by the ticket sync for older rows and walk-ins (by unique email, else unique name, else the bidder number Set Up's order gives that ticket slot). Keeps the bidder tied to their ticket when its name or email changes |

### Sheet: 'Auction-Status'

`A2` holds the auction's state as text: `Prep`, `Live` or `Closed` (`server/utils/auctionState.ts`, mirrored in `src/lib/auctionState.ts`). It only moves forward from the app: **Go Live** (`POST /api/auction/go-live`, Prep -> Live only) and **Close Auction** (`/api/auction/close-and-cleanup`, writes `Closed`); Setup New Auction Year resets it to `Prep`. Going back is a manual edit of the cell. A sheet from before the three states holds a checkbox boolean: `TRUE` reads as Prep and `FALSE` as Closed; blank or unrecognized reads as Prep. Live behaves exactly like Prep for now - it is there for the user-role work in `ROADMAP.md`.

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

If the Sheets write itself fails (no spreadsheet configured, an expired/missing OAuth session, a Sheets API error), the report is never silently lost: in production the server writes it as one structured Cloud Logging entry (`jsonPayload.bugReport`, screenshot omitted); locally it writes a self-contained `.md` file (+ sibling `.png` if a screenshot was captured) under a gitignored `bug-reports/` directory at the repo root.

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
      "auctionItemsScriptId": "string (unused - see below)",
      "auctionTicketsScriptId": "string (unused - see below)",
      "bidManagementScriptId": "string (unused - see below)",
      "bugReportsSpreadsheetId": "string (Google Sheet ID - see 'Bug-Reports' sheet above)",
      "bugReportsFolderId": "string (Google Drive folder ID for report screenshots, optional)",
      "updatedAt": "timestamp (server-set on save)",
      "updatedBy": "string (email of the saving admin)"
    }
    ```
*   The three `*ScriptId` fields are never read: the server runs the
    Apps Scripts by its Cloud Run settings `SCRIPT_ID_ITEM_ENTRY`,
    `SCRIPT_ID_TICKETS` and `SCRIPT_ID_BID_MANAGEMENT`, and the Settings
    page no longer shows boxes for them. They are still saved through
    unchanged.
*   Only the server reads or writes this document
    (`server/services/configService.ts`, cached 30 seconds and replaced
    on save). Browsers get it from `GET /api/config` - every signed-in
    staff member gets all of it, a volunteer only the Bid Management
    fields - and Full Administrators save it with `POST /api/config`
    (validated, recorded in Action History, and announced on the change
    feed as `config` so open screens reload it). `firestore.rules` denies
    browsers everything.

### Spreadsheet: Action History (`Actions` tab)

Who did what this season (`server/services/actionHistoryRows.ts`). Created by **Settings > Action History > Create Action History spreadsheet** in the Auction/General Auction Info/Template Files folder (`DRIVE_TEMPLATE_FILES_FOLDER_ID`), next to the master Bid Management and Item Entry spreadsheets; its ID is kept in Firestore `system/actionHistory` (`{ spreadsheetId, createdBy, createdAt }`, server-only - not in the shared Config, so `firestore.rules` didn't change). Archived as "{year} Action History" with the other spreadsheets, and cleared (`A2:O`) by Setup New Auction Year after the backup.

| Col | Header | Notes |
|---|---|---|
| A | Action ID | `yyyymmdd-hhmmss-xxxxxx`, unique |
| B | Timestamp | ISO |
| C | Who | Signed-in address (a volunteer's own email, later) |
| D | Role | Full Administrator / Administrator / User; "Spreadsheet editor" for sheet edits |
| E | Source | `App`, or `Sheet edit` (written by the Items/Tickets scripts' `ActionHistoryTracking.gs` on-edit trigger) |
| F | Area | Bid Management / Auction Items / Tickets / Settings / Users |
| G | Action | e.g. Record winning bid, Edit item, Bundle items, Edit attendee |
| H | Target | e.g. Item 312, Bidder 104, `'tickets'!F57` |
| I | Summary | One readable line |
| J / K | Before / After | Values (JSON when not plain text) |
| L | Location | Spreadsheet and range written |
| M | Undo | Blank (undoable), `Undone by ... at ...`, or `Can't be undone: <reason>` |
| N | Undo of | On an Undo row: the Action ID it reversed |
| O | Undo Data | What Undo needs (`UndoSpec`, `server/utils/undoSpec.ts`); blank = not undoable. App rows: `v1:<HMAC>:<JSON>`, signed over the Action ID and JSON with a key derived from `SESSION_SECRET` (`server/utils/undoData.ts`) - a hand-edited or copied row fails the check. Sheet-edit rows: plain JSON, accepted only as one cell of the configured Items or Tickets spreadsheet |

Written RAW by the app (typed text is never run as a formula). Anyone on staff can edit this spreadsheet, so Undo never trusts it alone: see Undo Data above, and Firestore `undoneActions/{actionId}` (server-only) records each action already undone, so clearing column M can't make it undoable again. If the spreadsheet isn't set up or a write fails, the row goes to Cloud Logging (`jsonPayload.actionLog`) instead.

### Collection: `volunteers` (server-only)

Volunteer access (`server/services/volunteerService.ts`). Auto-generated document IDs.

*   `email`, `name`: who was invited (re-inviting an address reuses its record)
*   `status`: `invited` (link sent) -> `active` (link used) -> `deactivated` (the auction closed) or `revoked` (an admin ended it)
*   `tokenHash`: SHA-256 of the one-time link token, cleared once used, revoked or deactivated - the token itself is never stored
*   `invitedBy` / `invitedAt`, `redeemedAt`, `lastSeenAt` (at most once a minute), `deactivatedAt` / `deactivatedReason`

`system/volunteerAuth` holds the shared volunteer account's stored sign-in: `{ refreshToken, email, connectedBy, connectedAt }`.

### Collection: `users` (server-only)

Staff roles (`server/services/userService.ts`). Document ID = the lowercased @orns.org address.

*   `email`: the address
*   `role`: `"full_admin"` or `"admin"` (or `"user"` after a role is removed). No document, or no role, means User
*   `assignedBy` / `assignedAt`: who gave the role, and when
*   `lastLoginAt`: set on every sign-in, so the Users tab lists everyone who has used the app

`FULL_ADMIN_EMAILS` addresses are Full Administrators whatever this collection says. Only the server reads or writes it (firebase-admin); `firestore.rules`' default deny keeps browsers out.

---

## 3. Transactional APIs & Surcharge Computations

All payment surcharge evaluations must be executed server-side.

*   **Implementation**: `calculatePayPalSurcharge` in `server/utils/financeUtils.ts` (percent rate 3.49%, flat fee $0.49). There is no standalone HTTP endpoint for it - it runs inside the receipt, email, and invoice paths (`receiptDataService.ts`, `emailService.ts`, `paypalService.ts`).
*   **Surcharge Formula**:
    $$\text{Total Paid} = \frac{\text{Subtotal} + \text{Flat Fee}}{1 - \text{Surcharge Percentage}}$$
    *Calculated via `PayPalService.calculatePayPalSurcharge` to ensure consistency between sheets logging and billing invoices.*
