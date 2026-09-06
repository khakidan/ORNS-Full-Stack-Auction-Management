# Refactor Opportunities

Running list of concrete, verified work items for this codebase - not
aspirational ideas, but things confirmed against the real code. When an
item is done, remove it from this file entirely - the paper trail for
completed work lives in [`CHANGELOG.md`](./CHANGELOG.md), not here. This
file only ever reflects the current, outstanding backlog. Net-new
feature work belongs in [`ROADMAP.md`](./ROADMAP.md) instead.

---

## Tasks To Refactor

**2026-09-02 deep audit**: bugs, dead code, redundancy, and test-coverage
gaps, verified directly against real code. Sorted by severity within
each area.

**2026-09-04 standards audit**: measured against `component-standards.md`,
`patterns.md`, `react-patterns.md`, `style_guide.md`,
`tailwind-style-guide.md`, `testing-philosophy.md` - three parallel
passes, findings independently spot-verified against real code before
being logged here (one claimed finding, a supposed `h-[650px]`
duplication between `DataTableWrapper.tsx` and `Items.tsx`, turned out
on inspection to be a docblock comment illustrating the prop next to its
one real usage site, not an actual second call site - dropped rather
than logged). This pass also found `component-standards.md` and
`react-patterns.md` each citing "known gaps" (no `IconButton`/
`LoadingButton`/`ConfirmationDialog`/table wrapper, six oversized
components) that had already been closed by feature work since those
docs were last verified - corrected directly in both docs rather than
logged here, since the fix was the doc text itself, not a backlog item.

### Redundant/duplicated logic

Nothing outstanding right now - every item flagged in the 2026-09-02
deep audit's "Redundant/duplicated logic" section has been closed. See
`CHANGELOG.md` for the individual fixes.

### Code quality

Nothing outstanding right now - every item flagged in this section has
been closed. See `CHANGELOG.md` for the individual fixes.

### Test coverage gaps (`testing-philosophy.md`)

Nothing outstanding right now - every gap and SHALLOW/CIRCULAR/SMOKE-rated
test flagged in this section has been closed. See `CHANGELOG.md` for the
individual fixes.

### Code Hardening

**Standing principle for every `.gs` file in this app** (established while closing out Bid Management's and Items' GAS passes - see `CHANGELOG.md` for the full history): each one should either (a) receive already-resolved data from Node as a parameter and turn it into an artifact - a Doc, Slide, PDF, label, or email - and do nothing else, or (b) be a background service with no request to attach to in the first place (e.g. the PayPal sweeper, now Node-side). Nothing should be left reading a sheet itself just to make a financial decision, mutate checkout/invoice state, or resolve a data list Node could hand it directly - Node already has full Sheets API read/write access, so there's no technical reason for that split to exist. Apply this same lens to any future `.gs` audit (item #1 below), including the Tickets-spreadsheet project (not yet audited against this standard) and the Bid Management/Items GAS "Not candidates" lists in `CHANGELOG.md`'s history if either is ever revisited.

1. **Broad hardening pass over the rest of the app** (concurrency safety, idempotency, error handling, validation, client-side robustness) - the original ask was open-ended; this is what a full audit against the app's own already-established conventions (`withLock`, idempotency keys, per-row batch resilience) actually found. Sorted by severity; each confirmed directly against current code, not inferred from names.

   **Real bug - same concurrency-race pattern already fixed for Bid-Management/Bidder-Numbers, never extended to Auction-Items:**

   - [x] ~~`server/services/bidderService.ts`'s `checkInBidderWithBid` was never wrapped in `withLock`~~ **Done - see `CHANGELOG.md`.** Now wrapped in the same `bidder-numbers:${spreadsheetId}` lock its siblings (`registerWalkInBidder`/`recordWinningBid`/`checkoutMarkPaid`) already use.
   - [x] ~~`server/services/itemService.ts`'s `addItem`/`deleteItem`/`updateItem`/`bulkUpdateItems` and `server/services/bundleService.ts`'s `processBundle`/`restoreBundle` all read the full `'Auction-Items'!A:L` range, mutate the in-memory 2D array, then overwrite the whole range - none imported or used `withLock` at all~~ **Done - see `CHANGELOG.md`.** Now all six are wrapped in a new `auction-items:${spreadsheetId}` lock key - a different resource than `bidder-numbers:*`, so it doesn't serialize against the bidder-mutating functions.

   **Real bug - colliding "Follow-Up" sheet schemas:**

   - Two independent code paths auto-create and write to a sheet literally named `"Follow-Up"` in the same Bid-Management spreadsheet, with incompatible column schemas: `auctionService.ts`'s `recordWinningBidLocked` (3-col header `["Bidder ID","Item ID","Amount"]`, writes `Follow-Up!A:C`, triggered when a bid is recorded for an already-checked-out bidder) vs. `paypalSweeperJob.ts`'s `ensureFollowUpSheet` (6-col header `["Timestamp","Bidder Number","Name","Amount Flagged","Invoice URL","System Notes"]`, writes `Follow-Up!A:F`, triggered when a PayPal-pending invoice times out). Whichever trigger fires first "wins" the header/column layout for the auction; the other's later appends land under the wrong header with misaligned data. Already flagged as a known, not-yet-resolved risk when the sweeper moved to Node (see `CHANGELOG.md`'s Code Hardening item #2 Step 4 entry) - needs one owner/schema (or a shared `ensureFollowUpSheet`/append helper) for both paths.

   **Real risk - no client-side error boundary anywhere:**

   - Confirmed via grep: zero `ErrorBoundary`/`componentDidCatch` in `src/`; `src/main.tsx` renders `ConfigProvider > AuthProvider > AuctionProvider > App` with no catch boundary at any level. Any render-time exception (e.g. a malformed/missing Sheets response reaching a `.map`/property access) white-screens the entire app with no recovery path - including mid-checkout or mid-bidding at a live event, where a crash is especially high-cost. Needs a top-level boundary around `<App />` at minimum.

   **Minor:**

   - `server/routes/bidRoutes.ts`'s `POST /auction/record-winning-bid` validates `price` only by truthiness (`!price`), not that it's numeric. A non-numeric `price` gets stored as-is; `receiptDataService.ts`'s `resolveWonItems` (`parseFloat(...) || 0`) then silently treats it as $0 - the item is recorded as "won" but invoiced for nothing, with no error surfaced anywhere. Low likelihood (the UI always sends a number today) but silent rather than loud if it ever happens.
   - `server/routes/dataRoutes.ts`'s `POST /settings/update` has neither `withLock` nor an idempotency key, unlike sibling mutating routes - low likelihood given Settings is normally single-admin, but an inconsistency worth closing for consistency's sake. `POST /auction/delete-item` has no `idempotencyKey` unlike `add-item`/`bulk-update-items` - low real risk (re-deleting an already-blanked row is a no-op) but the same inconsistency.

   **Checked, confirmed fine - not re-flagging:** the generic Sheets proxy (`dataRoutes.ts`'s `/sheets/:spreadsheetId/:range`) trusts a client-supplied `spreadsheetId`/`range`, but every call goes through the user's own OAuth token, so Google's own per-user ACLs are the real authorization boundary, not this app. Every batch-processing loop already checked (`processAllEmails`, `buildAllBidderReceiptsWithInvoices`, `runPaypalSweep`) already wraps each item in its own try/catch with log-and-continue - the "one bad row shouldn't kill the batch" pattern is correctly applied everywhere it currently needs to be.

2. **Bid Management's PayPal sweeper cutover - two manual steps still outstanding.** `server/services/paypalSweeperJob.ts`'s `runPaypalSweep` now fully replaces `PayPalSweeper.gs`'s `checkPendingPayPalInvoices` (see `CHANGELOG.md`), but two things can only happen outside an agent session:
   - An admin must sign in to the app at least once so the sweeper has a background-sync credential to authenticate with (`persistSweeperCredential` only ever runs on a real login) - until then, sweep runs log `"No background-sync credential stored yet"` and no-op.
   - Once the Node job is confirmed running reliably in production (watch server logs for `[PayPalSweeper]` lines across a few real sweep cycles), delete `PayPalSweeper.gs` and its GAS time-driven trigger from the live Apps Script project, and `Class_PayPalService.gs`'s now-redundant copy of `calculatePayPalSurcharge` if nothing else GAS-side still needs it.

### UI / Layout Tweaks

1. We should look into making all of the pages have a more visually appealing and user-friendly design. We should use the newly created Attendee List table on the Auction Tickets page as inpiration — and keep that same visual feel to it.

---

## Passed Audit Inspection

Checked directly against the standards docs and confirmed correct -
listed so future audits don't have to re-derive this, and so nobody
"fixes" something that isn't broken.

- **No native `<select>`** outside test-mock files (`component-standards.md`) -
  every real dropdown goes through `src/components/ui/select.tsx`.
- **Winner-notification toast rule implemented correctly**
  (`patterns.md`) - the `duration: Infinity` + `"I have confirmed"`
  action pattern is present in `Bidders.tsx`, `Checkout.tsx`,
  `Dashboard.tsx` (×2), and `ConfigSettings.tsx`'s analogous manual-copy
  confirmation.
- **Bundle restoration and category re-sequencing are server-side and
  correct** (`patterns.md`) - `server/services/bundleService.ts` sets a
  restored bundle to `"Inactive"`, clears its sequential ID, and calls
  `resequenceCategoryIds()` on both the create- and restore-bundle
  paths.
- **PayPal surcharges are never calculated client-side** (`patterns.md`) -
  lives only in `server/services/paypal.ts` /
  `server/utils/financeUtils.ts`.
- **Session cookie name is `orns_session`, not `__session`**
  (`patterns.md`) - confirmed in `server/app.ts` and
  `server/routes/authRoutes.ts`.
- **`vite.config.ts`'s `manualChunks` is a functional matcher**, not a
  static object map (`patterns.md`, `performance.md`).
- **`firebase`'s init is lazy-loaded, out of the critical path**
  (`performance.md`) - `ConfigContext.tsx` defers `firebase/app`/`auth`/
  `firestore` behind a memoized `getFirebase()` (`src/services/firebase.ts`)
  instead of importing them statically. The deferred chunk itself grew
  (106 kB → 160 kB gzipped) since neither `@firebase/auth` nor
  `@firebase/firestore` declares `"sideEffects": false`, so Rollup can't
  tree-shake their unused exports across an async boundary the way it
  partially could in one static graph - confirmed via a
  `rollup-plugin-visualizer` treemap, and `firebase/firestore/lite`
  isn't a viable swap (it's REST-only; this app's config sync needs
  `onSnapshot`). Accepted trade-off: the critical path is what matters
  for `performance.md`'s budget, and it dropped either way (see
  `CHANGELOG.md`).
- **Route-level `React.lazy()` code-splitting is in place** for
  `ConfigSettings`, `AuctionTicketsWorkflow`, `AuctionItemsWorkflow`,
  wrapped in `<Suspense>` (`performance.md`, `style_guide.md`).
- **No direct `fetch()` calls outside `src/services/google-api.ts`**
  (`react-patterns.md`) - every network call goes through
  `fetchWithRetry`/`getBaseUrl`.
- ~~No derived-state duplication anti-pattern~~ **Correction (2026-09-04
  audit)**: this claim didn't hold - `useConfigSettingsState.ts:43-46`
  does exactly this. Moved to "Code quality" above as an open item
  rather than left here as a false "passed" claim.
- **Memoization applied where it matters, skipped where it doesn't**
  (`performance.md`, `react-patterns.md`) - `hooks/useAuctionItemsTableState.ts`
  and `hooks/useBiddersState.ts` wrap their filter/sort in `useMemo`
  (the latter's filter also does an O(n×m) `getBidderAttendeeInfo()`
  scan); lighter filters elsewhere correctly run unmemoized in render.
- **`useEffect` usage stays scoped to real external synchronization**
  (`react-patterns.md`) - 1-3 effects per file, none computing a value
  that could live in render.
- **Bare `.toHaveBeenCalled()` usage is not itself a shallow-assertion
  problem** (`testing-philosophy.md`) - every occurrence is either a
  `.not.toHaveBeenCalled()` negative assertion or
  `server/test/middleware.test.ts` confirming `next()` fired, neither of
  which has a meaningful payload to check. (Other shallow-assertion
  patterns - `expect.anything()`, asserting one field out of many,
  asserting call count but never arguments - were found in the
  2026-09-02 deep audit; see "Test coverage gaps" above.)

---

## Out of Scope, but Should be Fixed

Nothing outstanding right now.

---

## How to use this file

- Touching a file that also has an open item here? Fold the fix in -
  but don't turn an unrelated bug fix into a drive-by rewrite of an
  unrelated file.
- Log new findings the same way: concrete evidence (line count, grep
  hit, failed command), sorted into the right section above - not a
  vague "this could be cleaner."
- When an item is finished, remove it from this file entirely and
  record what happened in `CHANGELOG.md` instead. This file only ever
  shows the current, outstanding backlog - never a history of what's
  already done.
