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

## 2026-10-27 Audit Backlog (today's changes)

Read of everything changed on 2026-10-27 (`cf4ea05`..`bf7994a`: auction states, staff roles, Action History and Undo, volunteers, live refresh, server-served Config, edit-tracking toggle, Bid Entry checks - about 6,400 lines in 148 files), measured against the same criteria as the 2026-10-21 code audit (bugs, security, data integrity, operations) and the 2026-10-22 refactor audit (`AGENTS.md` and the guides under `docs/agents/`). Each item was confirmed by reading the cited code unless marked **(plausible - not reproduced)**. At audit time the suite was green (805 backend / 780 frontend) and lint was clean - none of these are caught by the existing tests.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

### Low

- **A6 - A staff sign-in can stay a volunteer.** `/auth/callback` adds `tokens` and `email` to the existing session but leaves a `volunteer` field from an earlier volunteer link in the same browser, and `requireAuth` checks `volunteer` first. Fix: delete `req.session.volunteer` on a staff sign-in.
- **A7 - Other POSTs that shouldn't repeat go through `postJson` (which retries):** volunteer invite and resend (a second email; the first link then fails), Undo (a retry reports "already undone" though it worked), Create Action History (a retry reports "already exists"). Use `postOnce`, or have the server answer a repeat as success.
- **A8 - Undo marks the row it found before undoing.** `markUndone` writes `M{rowIndex}` from the earlier `findAction`; a row inserted or a sort done by hand in between marks the wrong action. Re-find the row by Action ID just before marking.
- **A9 - Volunteers receive every Undo notice.** `GET /api/changes` is open to volunteers and returns all `notices`, including Settings, Users and Tickets undos with staff emails and attendee names. Send volunteers only Bid Management notices.
- **A10 - `touchVolunteer` can bring back a deleted record (plausible - not reproduced).** It writes `lastSeenAt` with `set(..., { merge: true })`; if Clear deactivated removes the record as a last request arrives, a blank record appears in the Volunteers table as "invited". Use `update()`.
- **A11 - "Edit tracking on" only means the script property is set.** `apiEditTrackingStatus` doesn't check that an on-edit trigger exists - triggers belong to the admin who installed them, and if that trigger is removed (account removed, trigger deleted by hand) the button still says Turn off while nothing is recorded. Record who turned it on and when, and show it next to the button.
- **A12 - Bid Entry's step check on repeatable and Live items (plausible - not reproduced).** `bidWarnings` applies the opening-bid-plus-raises rule to every item. Raffle tickets, Open Appeal tiers (`allowMultipleWinners`) and Live-auction items may not follow it if their sheet carries an Opening Bid and Minimum Raise. Check those items' figures; if needed, skip the step check for them.

### Structure - refactor

- **A13 - Routes still take spreadsheet IDs, tab names and the ticket price from the browser.** `bidRoutes.ts`, `receiptRoutes.ts`, `attendeeRoutes.ts`, Go Live and Close read `spreadsheetId`, `bidderNumbersSheet`, `bidManagementSheet`, `ticketPrice` etc. from the request body, though the server now has them (`getSharedConfig`). Read them on the server (body as a fallback during the change). This removes stale-browser bugs and lets `volunteerAccess.ts` drop its per-field ID checks.
- **A14 - Components over the 50-250 line guide, and state set in effects** (`component-standards.md`, `react-patterns.md`): `App.tsx` is 529 lines and redirects volunteers and non-admins with `setActiveWorkflow` inside effects - work out the allowed workflow during render in a `useWorkflowNavigation` hook. `ArchivedYearPanel.tsx` is 293 lines - split it by section.
- **A15 - The Action History list sends the whole log every time.** `listActions` returns every row, Undo Data included, on each load and on every live refresh (each logged action reloads every open Action History tab). Return the newest few hundred, page the rest, and leave Undo Data out of the list.

### Tests

- **A16 - Client gaps:** no test that `App.tsx` shows a volunteer only Bid Management (five tabs, no stage buttons) and the thank-you screen, and none that `AuctionContext`'s live refresh reloads the right data (`onRemoteChange` -> bidders, items, attendees, `reloadConfig`).

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

