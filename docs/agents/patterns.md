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
*   **DO NOT MODIFY core client SDK files**: Under no circumstances should you edit `src/lib/firebase.ts`, `src/context/ConfigContext.tsx`, or `firestore.rules` unless explicitly ordered.

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
*   **Tracking Columns**: The 'Bidder-Numbers' sheet contains automated tracking data fields in Column J (`Invoice URL`, public PayPal checkout) and Column K (`Invoice Total Amount`, numerical balance with fees).
*   **apiSendAllEmails**: Call this execution loop once all winning entries are processed. It internally evaluates rows, constructs unique invoices, logs them to Columns J/K, and dispatches custom checkout URLs.
*   **apiCreateAllReceipts**: Safe to run before or after emailing. It dynamically uses the cached 'Invoice URL' in Column J, or generates a new one to embed accurate QR codes within documents.
*   **apiCreateIndividualReceipt / apiSendReceiptEmail**: Target specific IDs, leverage the same caching logic, and auto-update tracking metrics. MUST pass strict primitive string or numerical items (e.g., `apiCreateIndividualReceipt(String(bidderId), emailReceipt)`).
*   **Surcharges**: NEVER manually calculate surcharge processing totals within the client application; `PayPalService.calculatePayPalSurcharge` natively executes this in the backend workspace.
