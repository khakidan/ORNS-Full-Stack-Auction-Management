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

**Put the live PayPal app's credentials on the server before ticket sales open** - see "Webhooks with Fluent Forms" step 2 below. The server still has the sandbox app, so it can't confirm real website ticket payments (or, at the auction, real checkouts).

---

## 2026-10-29 Test Quality Audit (whole suite)

A review of all 181 test files (1924 tests: 1085 backend, 839 frontend), at `404adf1`. It measured them against [`testing-philosophy.md`](./testing-philosophy.md): the GOOD/SHALLOW/CIRCULAR/SMOKE scale, the seam test standard and the mocking boundaries. It also used Testing Library's guidance on queries, `userEvent` and implementation details, and general standards for test suites: tests that pass for the wrong reason, deterministic concurrency tests, coverage of critical paths, and running the tests before release.

How it was done:

- every test file was scanned for known smells;
- the files that stood out were read;
- coverage was measured once with `@vitest/coverage-v8`, installed `--no-save` because it isn't a dependency: **lines 90.1%, branches 78.8%, functions 85.0%, statements 88.2%**;
- the backend suite was run 15 times to look for flaky tests.

The suite is in good shape overall. The problems are specific gaps, not systemic CIRCULAR or SHALLOW testing.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries. **High** means a real defect could ship unnoticed; **Medium** means the test can pass for the wrong reason or misses a rule; **Low** is about style and maintainability.

### High

- **[DONE 2026-10-29, Phase 1] T1 - Nothing runs the tests before a deploy.** There is no GitHub Actions workflow and no git hook, and the Cloud Build trigger only builds and deploys. So `main` deploys whatever was merged, whether or not `npm run test:quiet` and `npm run lint` were run. Every other item depends on the suite actually running.
  *Fix:* run `npm ci && npm run lint && npm run test:quiet` as a Cloud Build step before the image build, so a failure stops the deploy. Or add a GitHub Actions check and require it on `main`.
- **[DONE 2026-10-29, Phase 3] T2 - Most Action History entries are never checked (AGENTS.md rule 7).** `logAction` is a global spy (`server/test/setup.ts`), but only 16 of the 39 `action:` names in `server/routes` and `server/services` appear in any test. A route that stopped logging, or logged the wrong before/after values, would pass. The 23 untested names:
  - Bid Management: "Go Live", "Close auction", "Register walk-in", "Set special winner", "Check in with ticket payment", "Print receipt", "Print all receipts", "Email all receipts", "Add bidders from tickets", "Update bidders from tickets"
  - Items: "Add item", "Delete item", "Bulk edit items", "Bundle items", "Restore bundle"
  - Tickets: "Delete attendee"
  - Volunteers: "Invite volunteer", "Resend volunteer link", "Revoke volunteer", "Clear ended volunteers"
  - Settings: "Set up new auction year", "Archive auction", "Create Action History spreadsheet"

  Likewise `clearCacheForSpreadsheet` (rule 7's "every server write") is checked in only 6 test files, while 13 route and service files call it.
  *Fix:* in each route's existing happy-path test, assert `logAction` was called with `objectContaining({ action, before, after })`, and assert `changesSince(before).changed` contains the spreadsheet.
- **[DONE 2026-10-29, Phase 3] T3 - Some route bodies have never run in a test** (from coverage):
  - `POST /api/auction/special-winner` (`bidRoutes.ts`) has no HTTP test. `specialWinnerService` is tested on its own, but the route's validation, idempotency, and Action History undo spec are not.
  - The walk-in route's ticket path: clearing the tickets spreadsheet's cache, then `syncBiddersFromTickets` when `result.ticketAppended`.
  - The volunteer routes in `volunteerRoutes.ts` (60%): invite (including the refusal of `@orns.org` addresses and of invalid emails), resend, revoke and clear-ended, plus their 404s.
  - `syncBiddersWith` in `bidderTicketSync.ts`: the Action History records for renamed and added bidders. Every route test replaces it with the global spy, and its own test doesn't reach these lines.
  - `server/services/actionHistoryStore.ts` (0%). It is globally mocked, and `setup.ts` says "actionHistoryStore.test.ts covers the real module", but that file doesn't exist. This module holds `wasUndone`/`recordUndone`, the guard that stops an action being undone twice (A1). Reading it also turned up a likely bug: `setActionHistorySpreadsheetId` writes `system/actionHistory` without `merge`, so creating the spreadsheet would erase the `editTracking` record (A11) that `setEditTrackingRecord` merged in. Settings would then show edit tracking with no owner while the triggers are still installed.
  *Fix:* supertest cases for each route above, through the real app with MSW. For the store, a real `actionHistoryStore.test.ts` (fake Firestore, `vi.importActual`) covering the cache, the undo guard, and that creating the spreadsheet keeps `editTracking`; then fix the `merge`.

### Medium

- **[DONE 2026-10-29, Phase 2] T4 - Concurrency tests that wait a fixed time.** Two patterns use a real `setTimeout` instead of waiting for a signal:
  - *Wait, then act* ("give both a moment to reach the gate"): `auction-setup.test.ts:83`, `receipts.test.ts:611`, `auctionService.test.ts:186`, `bidderService.test.ts:189` and `itemService-concurrency.test.ts:73`. On a busy machine the first call may not have reached the lock yet, and the test fails.
  - *Wait, then check nothing happened*: `bidderService.test.ts:252`, `paypalSweeperJob.test.ts:352` and `specialWinnerService.test.ts:86`. These can pass even with the lock removed, because the code simply hasn't got there in 20-50 ms.
  The suite has intermittent single-run failures that pass on a rerun: a 429 in `bid-management.test.ts`, a 401 in `tickets.test.ts`, production's bidder labels, and `userRoles.test.ts` "a User can't change roles" (1 failure in 15 backend runs during this audit). Fixed-time waits are the likely cause of some of them.
  *Fix:* have the gated fake record that it was reached (a promise resolved inside the handler), and `await vi.waitFor(() => expect(reached)...)` before acting, as `ticketPoll.test.ts` does. To prove a write is held, assert it happens only after `release()`, not that nothing happened within N ms. Then rerun the suite in a loop to confirm the flakes are gone.
- **[DONE 2026-10-29, Phase 4] T5 - The browser-to-server requests are untested.** 43 test files mock `@/services/google-api` wholesale (the API seam, which is allowed), but `google-api.ts` itself is only 32% covered. The paths, methods and request bodies it builds are never checked, so a field renamed on one side would pass every test on both.
  *Fix:* test `google-api.ts` with MSW in jsdom, asserting each function's method, path and body. Or, better, share the request types between `src/` and `server/` so the compiler catches a mismatch.
- **T6 - Stubbed UI primitives hide real behaviour.**
  - The Dialog stub renders its children whether or not `open` is set (`ActionHistoryAdmin`, `Bidders`, `BundlingDialog`, `ConfigSettings`, `TicketAttendeeTab` and `VolunteersAdmin` tests). So those tests can't catch a dialog that never opens or never closes.
  - The Select stub swaps Base UI's select for a native `<select>` in 10 test files, so a select showing the wrong label, or one that can't be picked by keyboard, isn't caught.
  `src/components/ui/select.test.tsx` already drives the real Select in jsdom.
  *Fix:* use the real primitives (opening and choosing through their roles). Where a stub is kept, make it honour `open`.
- **[DONE 2026-10-29, Phase 4] T7 - Frontend writes with little coverage:**
  - `useWalkInForm` (21%): the walk-in registration form.
  - `useAddAuctionItem` (27%) and `useDeleteAuctionItem` (24%).
  - `BidManagementWorkflow` (26%): Set Up, Go Live and Close, including the new ticket-price message from Set Up.
  - `useBundling` (75%).
  These are the seam standard's main case: a user action becomes an API call. *Fix:* render the component, act with `userEvent`, and assert the exact payload sent to the API.
- **T8 - Assertions that accept any value:**
  - `items.test.ts:196` and `:596` assert only that `response.body.error` is defined, so any error passes. Assert the message.
  - Some positive bare `toHaveBeenCalled()` calls are on calls whose arguments matter: `useAttendeesData.test.ts:241` (`getSheetData`), `ConfigSettings.test.tsx:227` (`mockSaveConfig`), `AuctionItemsTab.editing.test.tsx:216` (`mockRefresh`) and `syncRoutes.ticketPrice.test.ts:79` (`performSheetSync`). Use `toHaveBeenCalledWith`. The other bare calls (a toast, `next()` in middleware) are fine.

### Low

- **T9 - Tests of CSS classes (61 assertions).** The main ones are in `ItemRow`, `FilterToolbar`, `select`, `BugReportsAdmin` and `AuctionItemsTab` ("does not tint the Select all bar"). They break on a restyle that changes nothing a user notices. Keep them only where the class *is* the behaviour, such as hidden, disabled or truncated text. Otherwise assert `toBeVisible`, `toBeDisabled` or accessible attributes.
- **T10 - Query and event style** (Testing Library guidance):
  - 108 `getByTestId` calls (25 in `Bidders.test.tsx`, many on the stubs from T6) where a role or label query would do.
  - 60 `fireEvent` calls (`ConfigSettings` 14, `AuctionItemsTab.bundling` 10, `BugReportButton` 8) where `userEvent` would be closer to a real user.
  - `toBeTruthy()`/`toBeFalsy()` on `getBy*`/`queryBy*` results (`Checkout.test.tsx` 17, `BugReportsAdmin.test.tsx` 6) instead of `toBeInTheDocument()`.
  Change these whenever the file is next touched; they aren't worth a sweep on their own.
- **[DONE 2026-10-29, Phase 1] T11 - Recorded snapshots on the money paths.** These snapshots are intentional golden masters that pin every Sheets and PayPal call while those paths are restructured (`moneyPaths.recorded`, `checkoutMarkPaid.recorded`, `syncService`). The risk is `vitest -u` accepting a changed write without anyone reading it. *Fix:* add a rule to `testing-batches.md`: never update these snapshots without reading the diff and naming the change in the commit.
- **T12 - No mutation testing.** Changes have been mutation-checked by hand, one at a time. *Fix:* run Stryker (`@stryker-mutator/vitest-runner`) now and then on the money paths: `financeUtils`, `checkoutService`, `ticketPaymentCheck`, `ticketPurchaseRow`, `bidderService` and `winningBidChecks`. Treat surviving mutants as missing tests.
- **[DONE 2026-10-29, Phase 1] T13 - Coverage isn't measurable from the repo.** `@vitest/coverage-v8` isn't a dev dependency, so nobody can see the numbers above without installing it. *Fix:* add it, plus an `npm run test:coverage` script, and record the totals in `testing-batches.md` beside the pass counts. Hold off on a coverage threshold until T1 exists to enforce it.

- **T14 - Rare 401s and timeouts in full parallel runs** (found in Phase 2's loop, 2026-10-29). Not from fixed waits; Phase 2 didn't fix them.
  - **401 (2 of 30 runs).** `bugReportRoutes` "writes 'Fixed' to column C" (staff session) and `volunteers` "is refused a walk-in" (volunteer session, expected 403) were each refused once as not signed in. Both pass on their own. Same family as the earlier `tickets` 401 and `userRoles` flakes.
  - **What's ruled out:** the cookie encoding. 20,000 freshly signed test cookies sent one after another all got through. A 19-run loop with `requireAuth` logging every 401 that carried a cookie caught no unexpected one: only the two tests that send a bad cookie on purpose.
  - **Timeout (1 of 19 runs).** `items` "invalid field name test" timed out at 5 s. That suggests a loaded machine, not a logic fault.
  - *Next step:* the 401 needs full parallel load to appear. Log it the same way in a long loop (50+ runs) and read what the session held. Suspects: anything shared within one test file that runs late, such as fire-and-forget writes (`touchVolunteer`) or a cache filled after a test's reset. Rerun the suite once before treating a lone 401 as real.

### Plan for writing the tests

Work in order: each phase makes the next one cheaper or safer. One branch and PR per phase (or per item where marked). Every PR follows the standing rules: `npm run test:quiet`, `npm run lint`, the totals in `testing-batches.md`, and a `CHANGELOG.md` entry naming the item IDs.

**How each new test is checked.** Every new test gets the mutation check used for the ticket-price work. Back up the source file with `cp`, delete or invert the line the test is meant to protect, run the test and see it **fail**, then restore from the backup. A test that still passes is rewritten before the PR. Each PR description lists the mutations tried, like #51's.

**Phase 1 - T1 and T13: run the tests on every PR.** *Done 2026-10-29 (branch `test-ci`): workflow on Node 24 (the active LTS) rather than 22; coverage totals in `testing-batches.md`. Proved with throwaway PR #54: one failing test, the check failed and GitHub marked the PR BLOCKED; closed unmerged.* The Cloud Build trigger (`cloudrun-orns-auction-manager-gh-us-east1-...`, europe-west1) builds with buildpacks from an inline config; there is no `Dockerfile` or `cloudbuild.yaml` in the repo. So:

1. Add `.github/workflows/test.yml`. On every pull request to `main` and every push to `main`, it runs `npm ci`, `npm run lint` and `npm run test:quiet` on Node 22. The `--no-experimental-webstorage` flag is already in `vitest.config.ts`.
2. In GitHub's branch protection for `main`, require that check. `gh pr merge` then refuses a PR whose tests fail, and the deploy trigger is left alone.
3. Add `@vitest/coverage-v8` (pinned to the installed vitest version) as a dev dependency and an `npm run test:coverage` script. Record the four percentages in `testing-batches.md`. No threshold yet.
4. Prove it: open a throwaway PR with one deliberately failing test, confirm the check fails and the merge is blocked, then close the PR.

**Phase 2 - T4: make the concurrency tests deterministic** (before adding more, so new tests don't copy the pattern). *Done 2026-10-29 (branch `deterministic-concurrency-tests`). Instead of order-of-events alone, the "check nothing happened" tests wait until the second writer is queued on the lock (`waitUntilQueuedOnLock`), which never happens without the lock - so a missing lock fails every run. 3 more tests with the same fixed wait were converted too (`receipts` H1 and print, `production` catalog); all 11 fail 5 runs out of 5 with their lock or guard given another key.*

  *Loop result: 2 failures in 30 backend runs, neither from a fixed wait, so they're now T14 (below).*

- Add a small helper, `server/test/helpers/gate.ts`:
  - `const gate = createGate()` gives `gate.wait()` (for a fake to `await`), `gate.reached` (a promise resolved when the fake first calls `wait`) and `gate.release()`.
  - MSW handlers and fake Sheets methods call `await gate.wait()` in place of their hand-built promise and release function.
- *Wait, then act* tests (`auction-setup.test.ts:83`, `receipts.test.ts:611`, `auctionService.test.ts:186`, `bidderService.test.ts:189`, `itemService-concurrency.test.ts:73`): replace the `setTimeout` with `await gate.reached`, then send the second request.
- *Wait, then check nothing happened* tests (`bidderService.test.ts:252`, `paypalSweeperJob.test.ts:352`, `specialWinnerService.test.ts:86`): record the order of events instead, and assert the guarded write comes after `"released"`. For example, `expect(order).toEqual(["other-writer-start", "released", "set-flag-done"])`. Mutation check: remove the `withLock` around the guarded write; the test must fail every time.
- Then run `for i in $(seq 1 30); do npx vitest run server/ || break; done`. If one of the known flakes (the 429 in `bid-management`, the 401 in `tickets`, production's bidder labels, `userRoles` "a User can't change roles") still appears, capture its full output and fix it in the same PR.

**Phase 3 - T2 and T3: Action History and the untested routes** (backend; one PR per area: Bid Management, Items, Volunteers, Settings). *Done 2026-10-29 (branch `action-history-tests`, one PR with a commit per area). All 39 action names are now asserted; "Record winning bid" was missing from the list below too. It found and fixed three bugs: the `merge` in `actionHistoryStore` (as predicted), and two rule-7 gaps - receipts' invoice/emailed writes and Setup New Auction Year never cleared the sheet cache. Also: `setup.ts` now empties the sheet cache between tests. Noted, not changed: record-winning-bid logs its range unquoted (`Bid-Management!A4:B4`); fine for the current tab names.*

- **Action History.** For each of the 23 action names, add assertions to the route's existing happy-path test in its file (`bid-management.test.ts`, `items.test.ts`, `receipts.test.ts`, `volunteers.test.ts`, `auction-setup.test.ts`, and so on). Don't write separate "it logs" tests:
  - `expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ area, action, target }))`, plus the `before`/`after` values where the route records them;
  - for a route with an `undo` spec ("Set special winner"), the spec's range and before/after values;
  - for a route without one, that `notUndoableReason` is a non-empty string;
  - for each spreadsheet written, `expect(changesSince(v).changed).toContain(<spreadsheetId>)` (the live-refresh half of rule 7).

  Mutation check: delete the route's `logAction` call, and separately its `clearCacheForSpreadsheet` call.
- **Special-winner route.** New `describe` in `bid-management.test.ts`. The Bid-Management sheet is served by MSW with a known prize cell. The tests cover:
  - a 400 for an unknown prize or a non-string bidder;
  - saving a winner (the exact `values.update` body);
  - clearing one (empty string);
  - `addFollowUp` adding the Follow-Up row only when the bidder has checked out;
  - a resend with the same `idempotencyKey` writing once;
  - the logged undo spec.
- **Walk-in ticket path.** In `bid-management.test.ts`, send `ticketsSpreadsheetId` and serve the Tickets sheet. Assert the appended ticket row (from `walkInTicketRow`, with the Config's ticket price), that both spreadsheets' caches are cleared, and that `syncBiddersFromTickets` (the global spy) was called because `ticketAppended` was true. Then check the opposite: without a tickets spreadsheet, it isn't called.
- **Volunteer routes.** In `volunteers.test.ts`, with Gmail's send endpoint served by MSW and the fake Firestore:
  - invite: 400 for no name, an invalid email, or an `@orns.org` address. On success, check the stored volunteer, that the emailed link's token matches the one stored, and the "Invite volunteer" log entry.
  - resend: 404 for an unknown ID; otherwise a new token and the old link refused.
  - revoke: 404, then status `revoked` and that volunteer's next request refused.
  - clear-ended: removes revoked and deactivated volunteers and keeps active ones, and the response's count matches.
  - every route: 403 for a User.
- **`syncBiddersWith`.** In `bidderTicketSync.test.ts` (which already uses the real module), pass a `record` spy and Sheets fixtures where one ticket was renamed and one is new. Assert the two entries' targets, summaries and before/after values, and that nothing is recorded when nothing changed.
- **`actionHistoryStore`.** New `server/test/actionHistoryStore.test.ts`, with `vi.unmock`/`vi.importActual` and the fake Firestore. It covers:
  - the cache (a second read within 30 s doesn't touch Firestore; after 30 s it does);
  - a Firestore failure returning the cached ID, or `""` when nothing is cached;
  - `wasUndone`/`recordUndone` round-tripping an action ID containing `/`;
  - **`setActionHistorySpreadsheetId` keeping an existing `editTracking`**. Write this test first and watch it fail, then add `{ merge: true }`.

  Also correct `setup.ts`'s comment.

**Phase 4 - T5 and T7: the browser side of the writes** (frontend). *Done 2026-10-29 (branch `frontend-write-tests`). Changes from the plan: T5 uses a recording `fetch` instead of MSW, because MSW can't intercept the app's relative `/api/...` URLs under jsdom. No 401 cases: these functions don't handle 401 (the change feed and the bid outbox do, and have their own tests). The walk-in, add-item and delete-item tests use the real Dialog and Select, moving those flows ahead of T6. The shared request types (`shared/apiTypes.ts`) are still open.*

- **T5.** New `src/services/google-api.test.ts` in jsdom, with MSW's `setupServer` (already used by the backend). For each exported function, call it and assert the request MSW received: method, path, query and JSON body. Also check how it handles a 4xx (the error message surfaced) and a 401 (sign-in prompt). The cases come straight from the server routes' validation, so a renamed field fails here.
  Longer term (separate item, if worth it): move the request body types into a shared `shared/apiTypes.ts` imported by both `src/` and `server/`, so `tsc` catches a mismatch.
- **T7.** Component-level seam tests, using the real component and real hook, with only `@/services/google-api` (or `apiClient`) mocked:
  - **Walk-in dialog** (`Bidders` page, `useWalkInForm`):
    - type a first name, last name and email, then submit;
    - assert `postJsonOnce` was called with `/api/bidders/walk-in` and exactly `{ firstName, lastName, email, ticketPrice: <Config price>, ... }`;
    - assert the dialog closes and the new bidder number is shown;
    - assert a server error keeps the dialog open with the message;
    - assert that submitting twice sends once.
  - **Add item and delete item** (`useAddAuctionItem`, `useDeleteAuctionItem`): fill the form or confirm the delete, then assert the exact payload, the refresh, and the error path.
  - **`BidManagementWorkflow`:**
    - Set Up sends the Config's two spreadsheet IDs once, and its toast shows the ticket-price message;
    - Go Live asks first and does nothing if the person cancels;
    - Close asks first;
    - the stage buttons are absent without `auction.stage`.
  - **`useBundling`:** the bundle and restore payloads, and the uncovered error branches.

**Phase 5 - T6 and T8: real primitives and exact assertions.**

- **T6.** One test file at a time, delete the `vi.mock("@/components/ui/dialog")` and `vi.mock("@/components/ui/select")` stubs and drive the real components, following `src/components/ui/select.test.tsx`:
  - open a dialog by clicking its trigger, and find it with `screen.findByRole("dialog")`;
  - choose an option with `user.click(screen.getByRole("combobox", { name }))` then `user.click(screen.getByRole("option", { name }))`;
  - assert dialogs close (`queryByRole("dialog")` is null after Save or Cancel).

  Add jsdom shims to the setup only if a primitive needs them, as `hasPointerCapture` and `scrollIntoView` already are. If a file can't move off a stub, change the stub to render nothing unless `open` is true.
- **T8.** Replace each listed `toBeDefined()`/bare `toHaveBeenCalled()` with the exact value. For `items.test.ts:196` and `:596`, use the route's actual message.

**Phase 6 - T9-T12: when files are next touched.** These are not sweeps of their own:

- T9 and T10: fix the test file being edited for other work. Swap class assertions for `toBeVisible`/`toBeDisabled`, test IDs for role and label queries, `fireEvent` for `userEvent`, and `toBeTruthy()` for `toBeInTheDocument()`.
- T11: add the snapshot rule to `testing-batches.md` in Phase 1's PR.
- T12: once Phases 1-5 are done, run Stryker once on the money-path files, list the surviving mutants here as new items, and decide then whether to run it regularly.

Rough size: Phase 1 is small (one workflow and one setting). Phases 2 and 5 are medium. Phase 3 is the largest, at about 60-80 new or extended tests. Phase 4 is about 30-40 tests. Expected totals after Phases 1-5: roughly 1,050-1,100 frontend and 1,150-1,200 backend.

### Confirmed fine (don't "fix")

- No skipped, `.only` or `todo` tests. No test mocks the module it is testing, and no pure helper in `src/lib`/`server/utils` is mocked (the mocked `errorBuffer`, `bidOutbox` and `screenshotCapture` hold browser or global state).
- About 2.2 assertions per test, and 307 exact-payload assertions (`toHaveBeenCalledWith`), against 28 positive bare `toHaveBeenCalled()`: the seam standard is broadly followed.
- Route tests go through the real Express app with a real signed `orns_session` cookie (`helpers/session.ts`). All Google, PayPal and WordPress traffic goes through MSW, Firestore is an in-memory fake for every test, and per-test resets (`_reset...ForTesting`, `afterEach` clears) keep tests independent.
- The data-hook tests checked (`useAuctionStatusData`, for example) feed raw sheet values in and assert the state derived from them. That isn't CIRCULAR.
- The global spies in `setup.ts` for `logAction`, `bidderTicketSync`, `sharedConfig` and `idempotencyStore` are acceptable: each real module has its own test through `vi.importActual` (`actionHistory.test.ts`, `bidderTicketSync.test.ts`, `sharedConfig.test.ts`, `idempotencyStore.test.ts`). The exception is `actionHistoryStore`, under T3. T2 is about using these spies, not removing them.
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
