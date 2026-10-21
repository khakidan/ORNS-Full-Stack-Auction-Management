# Architectural Patterns & Critical Rules

This document outlines the core operational guidelines, synchronizations, and non-negotiable architectural rules for the **ORNS Charity Auction Manager**.

---

## 1. Data Synchronization Flow

*   **Transactional Sheets Sync**: Google Sheets serves as the central transactional storage. High-frequency queries (guest checks, bids, tickets) are routed through resilient Google API wrappers in `/server/services/google.ts` featuring auto-retry logic with exponential backoff.
*   **Shared Config State (Firestore)**: Configuration profiles, sheet IDs, and admin active states are synchronized dynamically via Google Cloud Firestore. This ensures administrative actions and active configuration parameters are propagated to all connected clients instantly.

---

## 2. Non-Negotiable Rules (DO NOT VIOLATE)

### File Preservation
*   **NEVER DELETE `server/routes/bidRoutes.ts`**: This route manages key transactional bid bindings. Deleting, moving, or merging this file breaks the main live-auction flow.
*   **DO NOT MODIFY core client SDK files**: Under no circumstances should you edit `src/services/firebase.ts`, `src/context/ConfigContext.tsx`, or `firestore.rules` unless explicitly ordered.

### Session Cookie Rules
*   **DO NOT REVERT COOKIE NAME**: The session cookie **MUST** remain named **`orns_session`**. The legacy `__session` name was a Firebase Hosting caching CDN constraint that is no longer required on Cloud Run.

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
*   **Receipts** (`POST /api/receipts/generate`, `/generate-all`): Node resolves each bidder's won items and invoice, then hands the finished data to the Bid Management Apps Script's `apiCreateIndividualReceipt(String(bidderId), null, receiptData)` / `apiCreateAllReceipts(null, receipts)`, which only render the Doc/PDF (with the QR code). Pass the bidder ID as a strict string primitive.
*   **Emails** (`POST /api/receipts/email-all`, `/email-only`): sent from Node via the Gmail API (`server/services/emailService.ts`'s `processEmail` / `receiptService.ts`'s `processAllEmails`) - there is no Apps Script email function. Note: the email path currently links whatever URL is cached in Column J rather than resolving the invoice first - see `ROADMAP.md` item H2.
*   **Surcharges**: NEVER manually calculate surcharge processing totals within the client application; `calculatePayPalSurcharge` (`server/utils/financeUtils.ts`, used by `PayPalService`) executes this server-side.
