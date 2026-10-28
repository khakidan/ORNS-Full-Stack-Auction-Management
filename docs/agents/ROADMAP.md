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

Goal: make ticket purchasing as hardened as it can be - no purchase silently missing from the app, and payment status that's right at the door. Planned 2026-10-28; build and rehearse well before the March/April 2027 auction.

**How tickets get in today** (read from the live site through the Fluent Forms connector on 2026-10-28):

- The "Auction Tickets" form (Fluent Forms form 7 on orns.org, unpublished between seasons) has one integration: a Google Sheets feed ("Auction Tickets", feed 89) that appends each submission to the Auction Tickets spreadsheet's `tickets` tab. Nothing in this codebase receives purchases - the app only learns of a ticket when that row appears.
- The form collects name, address, email, phone, a ticket quantity (the payment field), up to 3 guests (name, email, "own bidder number?") and a payment method.
- Payments since 2025-01-01: 46 paid ($3,045), 38 pending ($2,590). Pending means the buyer chose to pay offline by cash or check - to the Director before the auction, or at the door - so it's expected, and check-in's add-to-receipt flow handles it (decided 2026-10-28, formerly W8).

**What can go wrong today:**

- If the Sheets feed fails (expired Google connection, renamed tab, a Sheets error), the purchase exists in WordPress but never reaches the app, and nobody is told - it's found at the door.
- A row written at submission says Pending; if a PayPal payment completes after the feed ran, the row may never be updated, so check-in shows "Pending" for someone who paid online. (Cash/check buyers are rightly Pending until they pay.)
- The feed writes what the public typed: no guests-vs-tickets check, no spreadsheet-formula guard (`sanitizeForSheetFormula`), no Action History row, no change-feed refresh. The row only becomes a bidder when the once-a-minute ticket sync next runs.

**Decisions made:**

- **"Pending" means paying offline** (cash or check, to the Director before the auction or at the door). Those rows are real purchases and are written to the sheet like any other; they stay Pending until staff record the payment in the app.
- **The spreadsheet stays where tickets are stored.** Everything in the app reads tickets from it. What changes is only who writes the row: eventually the app's server (webhook + poll) instead of the Sheets feed, through the same code path as the app's own Add Attendee.
- **The webhook is the fast path; a poll 3-4 times a day is the safety net.** Up-to-the-minute data isn't needed - only certainty that nothing is missed. A webhook missed while the app is down is caught by the next poll.
- **Shadow mode first.** The Sheets feed stays the writer until the webhook and poll have been proven against test purchases; then the feed is turned off. Never run both as writers - a webhook arriving before the feed's row would make a duplicate.

**Items** (IDs are stable - refer to them in commits and `CHANGELOG.md`; W1-W3 are done, see `CHANGELOG.md`):

- **W3/W5 both end in `upsertTicketPurchase` (W2, `server/services/ticketPurchaseService.ts`).** Each translates what it receives into a `TicketPurchase` (`ticketPurchaseRow.ts`) - the webhook's payload, or a REST API entry - dropping nothing the row needs, and passes `mode: "compare"` until the switch-over (rollout step 3), then `"write"`. Its outcomes (`added`, `exists`, `needs-review`, `would-add`) are what W6's status card counts.
- **W4 - Payment status from the payment, not the form.** On a payment event (W3) or in the poll (W5), set the row's payment status (U) from Fluent Forms' payment record. Before marking Paid, check the PayPal transaction ID with PayPal's API (`paypalService.ts`) - the webhook can't send it (Fluent Forms has no smart code for the transaction ID), so read it from Fluent Forms' REST API by entry ID, the same API the poll uses - a forged or garbled request can't mark a ticket paid, the same rule as server-only surcharges. A refund sets it back and flags it for staff. Never move a row from Paid back to Pending from form data: a cash/check payment is recorded by staff in the app, and Fluent Forms will still say pending for it.
- **W5 - The poll: 3-4 times a day, never misses anything.** A Cloud Scheduler job (same setup as the PayPal sweeper; paused outside ticket season) calls an app endpoint 3-4 times a day. It reads form 7's entries from WordPress's REST API (Fluent Forms Pro's entries endpoint - confirm its path and paging), starting **after the last entry it fully processed** (a high-water mark in Firestore, not a time window), so an outage of any length is caught up on the next successful run. Each new entry goes through W2; each row still Pending whose payment method is PayPal is re-checked (W4) - cash/check rows are left to staff. Authenticates as a dedicated WordPress user that can only view entries and payments (`fluentform_entries_viewer`, `fluentform_view_payments`), with an Application Password in Secret Manager. A "Check now" button on the Tickets page runs it on demand; Set Up Bid Management App and bidder labels should run it first, so they never work from a list missing a purchase.
- **W6 - Status card on the Tickets page.** When the last webhook arrived; when the last poll succeeded (warn when it's over ~12 hours, i.e. two or more missed runs); entries the poll had to add (each one is a webhook that was missed); entries waiting in "needs review"; tickets still Pending after N days. A failure then shows up days before the auction, not at check-in.
- **W7 - Purchases after Go Live.** `syncBiddersFromTickets` already refuses to add bidders once the auction is Live. A purchase arriving then is written to the sheet but flagged on the status card for staff to handle as a walk-in, not silently held.
  - PENDING means that they plan to pay with CASH or CHECK offline and will either pay the Director before the Auction or will pay-at-the-door.

**Rollout:**

1. **Shadow mode, W4-W6 to go** (W1-W3 are done: rows carry their entry ID in column W, and the webhook is live in shadow mode, matching the Sheets feed's rows by entry ID): the webhook and poll compare against the sheet and report mismatches on the status card, but write nothing.
2. **Rehearse** with the form published in test mode and PayPal sandbox: a new purchase; a guest with their own bidder number; a payment that completes later; a refund; a webhook deliberately blocked (the next poll must add it); the app stopped for a few hours (the poll must catch up from the high-water mark).
3. **Switch over**: set `FLUENT_FORMS_TICKETS_MODE=write` on the service (the webhook and poll then write through W2), and turn the Sheets feed (feed 89) off.
4. Watch the status card through the first week of real sales.

