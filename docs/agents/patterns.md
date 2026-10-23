# Architectural Patterns & Critical Rules

This document outlines the core operational guidelines, synchronizations, and non-negotiable architectural rules for the **ORNS Charity Auction Manager**.

---

## 1. Data Synchronization Flow

*   **Transactional Sheets Sync**: Google Sheets serves as the central transactional storage. High-frequency queries (guest checks, bids, tickets) are routed through resilient Google API wrappers in `/server/services/google.ts` featuring auto-retry logic with exponential backoff.
*   **Shared Config State (Firestore)**: Configuration profiles, sheet IDs, and admin active states are synchronized dynamically via Google Cloud Firestore. This ensures administrative actions and active configuration parameters are propagated to all connected clients instantly.

---

## 2. Non-Negotiable Rules (DO NOT VIOLATE)

### Session Cookie Rules
*   **DO NOT REVERT COOKIE NAME**: The session cookie **MUST** remain named **`orns_session`** - renaming it signs every user out. The legacy `__session` name was a Firebase Hosting caching CDN constraint that is no longer required on Cloud Run.
*   **The cookie is the only credential**: OAuth tokens live in the signed, `httpOnly` `orns_session` cookie and nowhere else - never in page HTML, `localStorage`, or a request header. (The `x-google-tokens` header/`localStorage` bridge that existed for running inside AI Studio's iframe was removed on 2026-10-21.)

### Code Splitting Rules
*   **Vite Chunks Form**: The `manualChunks` function inside `vite.config.ts` must use the dynamic functional matcher structure. Do not revert it to a static object-mapping form, as this breaks vendor code-splitting and balloons the critical chunk size.

### Auction Management Business Rules

#### Winner Notifications
*   **Persistent Warnings**: Always use `duration: Infinity` and an `action` with the label "I have confirmed" for toast warnings triggered when a bidder who has already checked out wins a gift card, raffle, or high-value item.
*   **Specific Messaging**: When a bidder wins an item after checking out, the notification must explicitly state the name of the item they won.

#### Bundling Workflow
*   **Item Restoration**: When restoring a bundle, the active bundle row must be deactivated (Status: "Inactive") and its sequential ID (Column A) cleared. The constituent items must be restored to "Active" status.
*   **Re-sequencing**: Any operation that changes item status or category must trigger a re-sequencing of the affected categories to ensure gap-free Auction Item IDs.

#### Charity Auction Workflows & PayPal Integration
*   **Tracking Columns**: The 'Bidder-Numbers' sheet contains automated tracking data fields in Column J (`Invoice URL`, public PayPal checkout), Column K (`Invoiced Amount`, numerical balance with fees), and Column L (the "PayPal Verification Pending" timestamp the sweeper reads). See `schema.md` for the full column layout.
*   **Invoice resolution is Node-side**: `server/services/receiptDataService.ts`'s `resolveInvoiceUrl` reuses the Column J invoice when Column K still matches the current total-with-fees, otherwise cancels the stale one and creates/sends a new one. Callers persist the result to Columns J/K - per bidder, immediately after each invoice is created, never batched at the end (a batch that dies mid-run would otherwise leave sent-but-unrecorded invoices that the next run duplicates).
*   **Receipts** (`POST /api/receipts/generate`, `/generate-all`): Node resolves each bidder's won items and invoice, then hands the finished data to the Bid Management Apps Script's `apiCreateIndividualReceipt(String(bidderId), null, receiptData)` / `apiCreateAllReceipts(null, receipts, fileName)`, which only render the Doc/PDF (with the QR code). Pass the bidder ID as a strict string primitive. Print All goes one part (25 bidders, one PDF) per request so no run nears Apps Script's 6-minute limit.
*   **Apps Script file names set their load order**: Apps Script runs a project's files in the order it stores them, and files uploaded with `clasp push` are stored sorted by name, ignoring case (`filePushOrder` doesn't change that). A class must load before any class that `extends` it, so base classes live in files named to sort first: `00_Class_GlobalVariables.gs`, `01_Class_GlobalStyles.gs`, `02_Class_DriveService.gs`, `03_Class_DocService.gs` / `03_Class_SlidesService.gs`. A new base class needs a numbered name too. `server/test/gs-push-order.test.ts` fails if any file uses a class before it loads. Deploy with `npm run gas:stamp` then `npm run gas:deploy`, never by hand: clasp 3.4.1 skips a push whose only change is a deleted file ("Script is already up to date"), and the `Version.gs` fingerprint is what guarantees every real change reaches Google (README "Deploying the Apps Scripts").
*   **Apps Script runs are never retried or overlapped**: every call that runs a script (documents, labels, receipts) is sent from the browser with `postOnce`, not `fetchWithRetry`, and runs on the server inside `runIfIdle` (409 for a second identical run) via `runAppsScript`. Each run creates a file, so a retry or a double-click makes a duplicate. Check the result with `isAppsScriptFailure`: the `api*` bridge functions report their own errors as `{ success: false, error }`, not as a failed run.
*   **Emails** (`POST /api/receipts/email-all`, `/email-only`): sent from Node via the Gmail API (`server/services/emailService.ts`'s `processEmail` / `receiptService.ts`'s `processAllEmails`) - there is no Apps Script email function. Both resolve each bidder's invoice exactly as receipts do (`attachInvoice`, under the `bidder-numbers:` lock) and email that invoice's link and its own total, so the email can never advertise a different amount than the link charges. Each send is recorded in Bidder-Numbers M/N; email-all skips a bidder whose Column N already holds their current invoice, so re-running it only emails bidders whose total changed. Email headers are CR/LF-stripped and RFC 2047-encoded, and the HTML body is escaped - names and item names come from sheet cells anyone can type into.
*   **Locking**: every write to Bidder-Numbers - checkout, walk-ins, check-in (with or without a bid), the Proxy flag, winning bids, invoice creation, Special-Winners/Follow-Up, and the PayPal sweeper - holds `withLock('bidder-numbers:<spreadsheetId>')`. Every Auction-Items write - add, edit (`/api/auction/update-item`, all changed fields in one request), bulk edit, delete, bundle, restore - holds `withLock('auction-items:<spreadsheetId>')`. A function that takes the lock itself (e.g. `processEmail`) must not be called by code already holding it; the lock isn't reentrant.
*   **No locked sheet through the passthrough**: the generic `POST /api/sheets/:id/:range` (and `/append`, `/clear`) takes no lock, so it answers 403 for Auction-Items, Bidder-Numbers, Bid-Management, Special-Winners, Follow-Up and PayPal-Follow-Up. A new write to one of those needs its own locked route. The passthrough's only remaining writers are the attendee edits on the ticket spreadsheets (`useTicketAttendeeState.ts`, `useAttendeesData.ts`), whose column layout lives in `src/lib/attendeeSheetColumns.ts`.
*   **Idempotency**: mutating routes run through `withIdempotency(<route>, idempotencyKey, fn)` (`server/utils/idempotency.ts`). A retry with the same key while the first request is still running waits for it rather than running the action again. `record-winning-bid` passes `{ durable: true }`, which also keeps the key in Firestore for 24 hours, because its requests can be resent long after they were made (below).
*   **Offline bids - only winning bids wait**: a winning bid that can't reach the server (`ServerUnreachableError` from `fetchWithRetry`, the browser offline, or a 401) is kept in the device's outbox (`src/lib/bidOutbox.ts`) and resent later with its original idempotency key; a 4xx is still undone on screen. Nothing else may be queued this way: checkout, receipts, invoices and emails touch money or email bidders, so they must run live or fail visibly. The server refuses a second winner for a one-winner item (409, `server/utils/winningBidChecks.ts`), since a device that was offline can't see what other devices recorded meanwhile.
*   **Surcharges**: NEVER manually calculate surcharge processing totals within the client application; `calculatePayPalSurcharge` (`server/utils/financeUtils.ts`, used by `PayPalService`) executes this server-side.
