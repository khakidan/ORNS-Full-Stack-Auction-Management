# Project Roadmap & Structural Blueprint

This document holds the **ORNS Charity Auction Manager**'s outstanding work: the verified bug/security/hardening backlog from the most recent code audit, followed by net-new feature milestones. When a backlog item is finished, remove it from this file entirely and record what happened in [`CHANGELOG.md`](./CHANGELOG.md) - this file only ever shows what's still outstanding, never a history of what's already done.

(The backlog used to live in `refactor-opportunities.md`; that file had gone stale - it reported Code Hardening as "fully closed" and its "Passed Audit Inspection" list cited files that no longer exist - so it was cleared on 2026-10-21 and this audit's findings were logged here instead.)

---

## ⚠️ DO THIS BEFORE THE AUCTION

**Test the cash/check surcharge removal against real PayPal (sandbox mode) at least once.** It's covered by unit tests that simulate PayPal's API, but has never been exercised against PayPal itself (see `CHANGELOG.md`'s L3 entry, `PayPalService.removeSurchargeLine` in `server/services/paypalService.ts`).

Steps:

1. Confirm the app is in PayPal sandbox mode (Config's `paypalIsSandbox`, or check the PayPal Integration tab in Settings).
2. Pick a test bidder who's won at least one item but hasn't checked out.
3. Print or email that bidder's receipt first, so a PayPal invoice exists for them (Checkout page, or Bidders page).
4. Log into the PayPal sandbox dashboard and find that invoice; note its total (it should include the processing fee).
5. In the app's Checkout page, mark that bidder paid with **Cash** (or **Check**).
6. If a yellow warning toast appears, the fee removal didn't go through cleanly - read what it says (it tells you what to do, e.g. mark the invoice paid by hand in PayPal) and note the wording so it can be looked into.
7. If no warning appears, refresh the invoice in the PayPal sandbox dashboard and confirm:
   - The processing-fee line item is gone.
   - The invoice total is now just the sum of the bidder's winning bids (no fee).
   - The invoice shows as **Paid**.
8. Once this works, remove this item and note the result in `CHANGELOG.md`.

If step 7 doesn't check out, cash/check checkouts will still work (the code falls back to recording the full fee-inclusive amount if the removal call fails) - but the bidder's invoice will keep showing the fee amount even though cash was collected without it. In that case let the dev know what happened in step 6/7 instead of using this feature for real auction checkouts yet.

---

## 2026-10-28 Audit Backlog (whole codebase)

A read of the whole codebase after A1-A17 shipped (`8f3a1ea`), measured against the same criteria as the 2026-10-21 and 2026-10-27 audits: bugs, security, data integrity and operations, plus the rules in `AGENTS.md` and the guides under `docs/agents/`. Each item was confirmed by reading the cited code. At audit time the suite was green (849 backend / 807 frontend) and lint was clean.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

### Low

- **B7 - A bug report can be saved and emailed twice.** The bug-report dialog posts with `postJson` (retried), and `POST /api/bug-reports` has no idempotency key, so a slow save that times out on the browser's side is appended to the sheet and emailed to web-admin@orns.org again. It also writes to whatever spreadsheet and folder the browser names (`bugReportsSpreadsheetId`, `bugReportsFolderId`) rather than the Config's. Fix: an idempotency key (the report's own ID); read both IDs from the Config.
- **B8 - Some writes aren't in Action History** (AGENTS.md rule 7): the document routes in `productionRoutes.ts` (catalog, bid sheets, labels, slides - each creates a Drive file); the bidder-label route's `ensureBidderNumbersSheet`, which can create Bidder-Numbers and assign every bidder number; and resolving a bug report (`/api/bug-reports/resolve`, which edits the Bug-Reports sheet and deletes a screenshot). Fix: log each with a `notUndoableReason`.
- **B9 - `window.open` without `noopener` in six places** (`PayPalIntegrationCard.tsx`, `FolderFilesCard.tsx`, `BidManagementWorkflow.tsx`, `WorkflowTabsShell.tsx`, `Receipts.tsx`, `useCheckoutReceiptActions.ts`). They open Google and PayPal pages, so the risk is small, but the opened page gets `window.opener`. Use `"noopener,noreferrer"` as the rest of the app does.
- **B10 - `GET /api/bidders/setup-status` takes its spreadsheet from the query string, unchecked for volunteers.** A13 removed `volunteerAccess.ts`'s body-ID checks, which never covered query strings; this route is on the volunteers' list. It only answers true/false using the volunteer account's access, but should read the Config like the other volunteer routes.

### Structure - refactor

- **B11 - The Config lives in two places.** Firestore `settings/global` is the Config, but the Apps Scripts read their own copy from the Bid Management spreadsheet's `_Settings` tab (receipt folder, logo, Items and Tickets IDs), which only the browser's Save Configuration writes, one `/api/settings/update` call per key after the Firestore save. If one of those six calls fails, or the Config changes any other way (Setup New Auction Year - B1), the scripts work from stale values. Fix: write `_Settings` from the server whenever the Config is saved (`POST /api/config`, the setup route), or pass every value from Node so the scripts stop reading `_Settings`.
- **B12 - A13's follow-up: more routes still take spreadsheet IDs from the browser.** Item add/edit/delete/bulk edit (`itemRoutes.ts`), bundle and restore (`bundleRoutes.ts`), the document routes (`productionRoutes.ts`), Set Up (`syncRoutes.ts`), `/settings/update`, Setup New Auction Year and Archive (`setupRoutes.ts`) and bug reports. Apply `fromConfig` to them too (with `auctionItemsSpreadsheetId`, `forPrintFolderId` and so on), so a stale tab can't edit last year's items.

### Tests

- **B14 - The frontend suite only passes with `--no-experimental-webstorage`.** `npm run test:quiet` sets it, but `npx vitest run src` (what an editor's test runner or a developer reaching for one file uses) fails 27 tests on Node's experimental `localStorage`. Set the flag in `vitest.config.ts` (a `poolOptions` `execArgv`) so every way of running the tests behaves the same, and note it in `testing-batches.md`.

### Confirmed fine (don't "fix")

- Every `/api` router is behind `requireAuth` except bug-report submission (rate-limited, deliberately open), `/api/health` and the Cloud Scheduler endpoint, which compares its secret in constant time (`schedulerRoutes.ts`).
- No `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere; every server-rendered HTML page escapes what it inserts (`escapeHtml`).
- Same-origin only (no CORS), JSON bodies, `sameSite: lax` cookie: a cross-site form can't send the API's JSON requests.
- Every component is within the 250-line guide after A14; the largest is `QuickBidEntry.tsx` (248).

---

## 2026-10-27 Audit Backlog (today's changes)

Read of everything changed on 2026-10-27 (`cf4ea05`..`bf7994a`: auction states, staff roles, Action History and Undo, volunteers, live refresh, server-served Config, edit-tracking toggle, Bid Entry checks - about 6,400 lines in 148 files), measured against the same criteria as the 2026-10-21 code audit (bugs, security, data integrity, operations) and the 2026-10-22 refactor audit (`AGENTS.md` and the guides under `docs/agents/`). Each item was confirmed by reading the cited code unless marked **(plausible - not reproduced)**. At audit time the suite was green (805 backend / 780 frontend) and lint was clean - none of these are caught by the existing tests.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

All items, A1-A17, are done - see `CHANGELOG.md` (search for the item ID).

### Confirmed fine (don't "fix")

- `requireAuth` / `requirePermission` deny by default; the volunteer allowlist's regexes are case- and trailing-slash-strict, so a mismatch refuses rather than allows.
- `trust proxy` is 1, so the volunteer-link limiter sees the real client IP on Cloud Run.
- `firestore.rules` denies browsers everything; deployed and read back on 2026-10-27.
- Action History rows are written `RAW`; the Apps Scripts prefix `=`, `+`, `@` with `'` in the display columns.
- The in-memory change feed is correct: the service is limited to one instance (service-level `maxScale: 1`).
- Go Live only moves from Prep; Close ends volunteer access; each volunteer request re-checks their status and the Live state (30-second cache).

---

## Feature Milestones (Staging)

### Webhooks with Fluent Forms

1. Look into implementing some kind of redundant feature to ensure that tickets don't get messed up.

