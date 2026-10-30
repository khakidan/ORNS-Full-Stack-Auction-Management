# Project Roadmap & Structural Blueprint

This document holds the **ORNS Charity Auction Manager**'s outstanding work: the verified bug/security/hardening backlog from the most recent code audit, followed by net-new feature milestones. When a backlog item is finished, remove it from this file entirely and record what happened in [`CHANGELOG.md`](./CHANGELOG.md) - this file only ever shows what's still outstanding, never a history of what's already done.

(The backlog used to live in `refactor-opportunities.md`; that file had gone stale - it reported Code Hardening as "fully closed" and its "Passed Audit Inspection" list cited files that no longer exist - so it was cleared on 2026-10-21 and this audit's findings were logged here instead.)

---

## ⚠️ DO THIS BEFORE THE AUCTION

**Put the live PayPal app's credentials on the server before ticket sales open** - see "Webhooks with Fluent Forms" step 2 below. The server still has the sandbox app, so it can't confirm real website ticket payments (or, at the auction, real checkouts).

---

## 2026-10-29 Test Quality Audit (whole suite)

A review of all 181 test files (1924 tests) at `404adf1`, measured against [`testing-philosophy.md`](./testing-philosophy.md) and Testing Library's guidance. Coverage was 90.1% of lines.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

All items, T1-T18, are done - see `CHANGELOG.md` (search for the item ID). How the suite is run and checked now (CI, coverage, mutation testing, the snapshot rule) is in [`testing-batches.md`](./testing-batches.md).

### Confirmed fine (don't "fix")

- No skipped, `.only` or `todo` tests. No test mocks the module it is testing, and no pure helper in `src/lib`/`server/utils` is mocked (the mocked `errorBuffer`, `bidOutbox` and `screenshotCapture` hold browser or global state).
- About 2.2 assertions per test, and 307 exact-payload assertions (`toHaveBeenCalledWith`), against 28 positive bare `toHaveBeenCalled()`: the seam standard is broadly followed.
- Route tests go through the real Express app with a real signed `orns_session` cookie (`helpers/session.ts`). All Google, PayPal and WordPress traffic goes through MSW, Firestore is an in-memory fake for every test, and per-test resets (`_reset...ForTesting`, `afterEach` clears) keep tests independent.
- The data-hook tests checked (`useAuctionStatusData`, for example) feed raw sheet values in and assert the state derived from them. That isn't CIRCULAR.
- The global spies in `setup.ts` for `logAction`, `bidderTicketSync`, `sharedConfig` and `idempotencyStore` are acceptable: each real module has its own test through `vi.importActual` (`actionHistory.test.ts`, `bidderTicketSync.test.ts`, `sharedConfig.test.ts`, `idempotencyStore.test.ts`). `actionHistoryStore` has its own test too (`actionHistoryStore.test.ts`).
- Areas are well covered: `server/middleware` 98%, `src/lib` 98%, `server/utils` 95%, `server/services` 94%.

---

## 2026-10-28 Audit Backlog (whole codebase)

A read of the whole codebase after A1-A17 shipped (`8f3a1ea`), measured against the same criteria as the 2026-10-21 and 2026-10-27 audits: bugs, security, data integrity and operations, plus the rules in `AGENTS.md` and the guides under `docs/agents/`. Each item was confirmed by reading the cited code. At audit time the suite was green (849 backend / 807 frontend) and lint was clean.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

All items, B1-B14, are done - see `CHANGELOG.md` (search for the item ID).

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

Goal: no website ticket purchase silently missing from the app, and payment status that's right at the door. W1-W7 are built and deployed (see `CHANGELOG.md`; set-up in `README.md` "Ticket payments (W4)", "Website ticket poll", "Website Ticket Check" and "Purchases after Go Live"), and the switch-over is done (2026-10-29): the app writes each `tickets` row (Pending until PayPal confirms the payment) and its bidder, and the form's Google Sheets feed (feed 89) is off - never turn it back on while `FLUENT_FORMS_TICKETS_MODE=write`, or a purchase is added twice. What's left:

1. **Rehearse in write mode** - the 2026-10-28 rehearsal ran in shadow mode only, so the write path (appending the row, Action History, the bidder sync, setting Paid) has only run in tests. With Fluent Forms' PayPal set to Sandbox Mode paying `web-admin@orns.org` (the account that owns the server's sandbox app) and the form submitted from its Preview link:
   - a PayPal purchase and a cash/check purchase each get their row from the app, Pending;
   - a PayPal payment PayPal releases is set Paid by the next poll, and one PayPal holds for review (`PENDING_REVIEW`, common in the sandbox) shows on the card's Needs review list until it is - neither has been seen live yet;
   - a refund, if the sandbox allows it (it refused while the payment was held on 2026-10-28) - the refund path has only run in tests;
   - then delete the test rows and entries, and set Fluent Forms back to **Live Mode** paying `pavetheway@orns.org`.
2. **Before ticket sales open:** put the **live** PayPal app's credentials ("Auction AI Receipts"; Transaction Search is already on) in `PAYPAL_CLIENT_ID` and the `PAYPAL_CLIENT_SECRET` secret - the sandbox app's are in `SANDBOX_PAYPAL_*` since 2026-10-29, so this can be done any time - and on the day, set PayPal to live on Settings > PayPal Integration and Fluent Forms' PayPal to Live Mode paying `pavetheway@orns.org` (the two must match). Until then every real PayPal ticket payment lands on the review list.
3. **Rotate `FLUENT_FORMS_WEBHOOK_SECRET`** (it appeared in a screenshot on 2026-10-28): a new value in Secret Manager, the same value in the form's Webhook feed request header, then redeploy.
4. **Publish form 7** for the season, and watch the Website Ticket Check tab through the first week of real sales.

Background (2026-10-28): the Sheets feed alone could miss a purchase without telling anyone, wrote Pending rows that were never updated when a PayPal payment completed later, and in the rehearsal wrote **Paid** for a payment PayPal was still holding for review. "Pending" means paying offline - cash or check to the Director, or at the door. The Cloud Scheduler job `fluent-forms-poll` runs all year (it's free while nothing changes).
