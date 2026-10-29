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

**Put the live PayPal app's credentials on the server before ticket sales open** - see "Webhooks with Fluent Forms" step 3 below. The server still has the sandbox app, so it can't confirm real website ticket payments (or, at the auction, real checkouts).

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

Goal: no website ticket purchase silently missing from the app, and payment status that's right at the door. W1-W7 are built and deployed (see `CHANGELOG.md`; set-up in `README.md` "Ticket payments (W4)", "Website ticket poll", "Website Ticket Check" and "Purchases after Go Live"). The webhook and the poll run in **shadow mode**: the form's Google Sheets feed (feed 89) still writes the `tickets` rows, and the app only compares and reports on the Tickets page's Website Ticket Check tab. What's left is rollout:

1. **Switch over.** Set `FLUENT_FORMS_TICKETS_MODE=write` on the Cloud Run service and turn the Sheets feed (feed 89) off in the same sitting - never both writing, or a purchase is added twice. From then on the app writes each row (always Pending until PayPal confirms the payment) and its bidder.
2. **Rehearse in write mode** - the 2026-10-28 rehearsal ran in shadow mode only, so the write path (appending the row, Action History, the bidder sync, setting Paid) has only run in tests. With Fluent Forms' PayPal set to Sandbox Mode paying `web-admin@orns.org` (the account that owns the server's sandbox app) and the form submitted from its Preview link:
   - a PayPal purchase and a cash/check purchase each get their row from the app, Pending;
   - a PayPal payment PayPal releases is set Paid by the next poll, and one PayPal holds for review (`PENDING_REVIEW`, common in the sandbox) shows on the card's Needs review list until it is - neither has been seen live yet;
   - a refund, if the sandbox allows it (it refused while the payment was held on 2026-10-28) - the refund path has only run in tests;
   - then delete the test rows and entries, and set Fluent Forms back to **Live Mode** paying `pavetheway@orns.org`.
3. **Before ticket sales open:** put the **live** PayPal app's credentials on the server (`PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET` in Secret Manager) and set PayPal to live on Settings > PayPal Integration. Until then every real PayPal ticket payment lands on the review list, because the server looks payments up with the sandbox app. Transaction Search is already on for the live app ("Auction AI Receipts").
4. **Rotate `FLUENT_FORMS_WEBHOOK_SECRET`** (it appeared in a screenshot on 2026-10-28): a new value in Secret Manager, the same value in the form's Webhook feed request header, then redeploy.
5. **Publish form 7** for the season, and watch the Website Ticket Check tab through the first week of real sales.

Background (2026-10-28): the Sheets feed alone could miss a purchase without telling anyone, wrote Pending rows that were never updated when a PayPal payment completed later, and in the rehearsal wrote **Paid** for a payment PayPal was still holding for review. "Pending" means paying offline - cash or check to the Director, or at the door. The Cloud Scheduler job `fluent-forms-poll` runs all year (it's free while nothing changes).
