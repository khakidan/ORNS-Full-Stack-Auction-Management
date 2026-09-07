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

Nothing outstanding right now - the "No UI anywhere to set an item's Allow
Multiple Winners flag" item has been closed. See `CHANGELOG.md` for the fix.

### Test coverage gaps (`testing-philosophy.md`)

Nothing outstanding right now - every gap and SHALLOW/CIRCULAR/SMOKE-rated
test flagged in this section has been closed. See `CHANGELOG.md` for the
individual fixes.

### Code Hardening

**Standing principle for every `.gs` file in this app** (established while closing out Bid Management's and Items' GAS passes - see `CHANGELOG.md` for the full history): each one should either (a) receive already-resolved data from Node as a parameter and turn it into an artifact - a Doc, Slide, PDF, label, or email - and do nothing else, or (b) be a background service with no request to attach to in the first place (e.g. the PayPal sweeper, now Node-side). Nothing should be left reading a sheet itself just to make a financial decision, mutate checkout/invoice state, or resolve a data list Node could hand it directly - Node already has full Sheets API read/write access, so there's no technical reason for that split to exist. Apply this same lens to any future `.gs` audit, including the Tickets-spreadsheet project (not yet audited against this standard) and the Bid Management/Items GAS "Not candidates" lists in `CHANGELOG.md`'s history if either is ever revisited.

The broad hardening pass this section used to track (concurrency safety,
idempotency, error handling, validation, client-side robustness) is fully
closed - every finding from that audit (the `checkInBidderWithBid`/
Auction-Items concurrency-race fixes, the colliding "Follow-Up" sheet
schemas, the missing client-side error boundary, and the two "Minor"
findings) has been resolved. See `CHANGELOG.md` for the individual fixes.

1. **Bid Management's PayPal sweeper cutover - two manual steps still outstanding.** `server/services/paypalSweeperJob.ts`'s `runPaypalSweep` now fully replaces `PayPalSweeper.gs`'s `checkPendingPayPalInvoices` (see `CHANGELOG.md`), but two things can only happen outside an agent session:
   - An admin must sign in to the app at least once so the sweeper has a background-sync credential to authenticate with (`persistSweeperCredential` only ever runs on a real login) - until then, sweep runs log `"No background-sync credential stored yet"` and no-op.
   - Once the Node job is confirmed running reliably in production (watch server logs for `[PayPalSweeper]` lines across a few real sweep cycles), delete `PayPalSweeper.gs` and its GAS time-driven trigger from the live Apps Script project, and `Class_PayPalService.gs`'s now-redundant copy of `calculatePayPalSurcharge` if nothing else GAS-side still needs it.

### UI / Layout Tweaks

1. We should look into making all of the pages have a more visually appealing and user-friendly design. We should use the newly created Attendee List table on the Auction Tickets page as inpiration — and keep that same visual feel to it.
   - [x] ~~Bid Management's "Bidders" tab (Bidder Check-In)~~ **Done - see `CHANGELOG.md`.** Replaced the old `<table>`-based `BiddersTable.tsx`/`BidderRow.tsx` (two stacked status badges crammed into one narrow column) with a flexible row list (`BiddersList.tsx`/`BidderRow.tsx`, matching `AttendeesList.tsx`/`AttendeeRow.tsx`'s pattern exactly) - all the same information and actions, just laid out as one row per bidder instead of fixed table columns. The old clickable-column-header sort moved to a "Sort by" select in `BiddersFilterControls.tsx`, since there's no table header left to click.
   - [x] ~~Bid Management's "Items" tab (the read-only Auction Catalog)~~ **Done - see `CHANGELOG.md`.** Replaced the old bare 4-column `<table>` (built on `DataTableWrapper`) with a flexible row list (`ItemsList.tsx`/`ItemRow.tsx`, matching the same pattern) - and, unlike the Bidders redesign, genuinely enriched the view: description, value/opening bid/min raise, donor, item type, and bundle status were all already on every item but invisible in this table before. Search/filter/sort/empty-states unchanged.
   - [x] ~~The Auction Items Management page's "Auction Items Database" (the editable counterpart to the read-only Items tab above)~~ **Done - see `CHANGELOG.md`.** Same flexible-row pattern (`AuctionItemsList.tsx`/`AuctionItemRow.tsx`), plus the single-item-edit-as-dialog pattern the user specifically asked for (`EditAuctionItemDialog.tsx`, mirroring `EditAttendeeDialog.tsx` - replaces 9 separate per-field inline editors with one form/one Save). Editing, deleting, batch category/type-set, and bundling all still work exactly as before - only the row layout and the single-item-edit UI changed. `EditableCell.tsx` (now unused anywhere) was deleted as a result.
   - [x] ~~Bid Management's "Checkout" tab~~ **Done - see `CHANGELOG.md`.** Pitched as an Artifact mockup first, approved, then implemented: a new `CheckoutStatsRow.tsx` KPI row (Total Winners/Awaiting Checkout/Checked Out/Total Collected), the two previously-stacked action bars merged into one `FilterToolbar.tsx` (search + a new Status quick-filter + Refresh/Print All/Email All), and `WinnerCard.tsx` redesigned with a color-coded status chip/left border, initials avatar, a capped scrollable item list, and an inline "No Email" label instead of a hover-only tooltip. `PaymentMethodDialog.tsx` got an icon + explicit checkmark per method instead of a plain color swap. All existing actions (batch print/email, per-winner email/print/checkout, the Pending/Checked-Out tab split, Cash/Check/Card payment) are unchanged in behavior.
   - Still open: the rest of the app's pages (Dashboard, Receipts, etc.) haven't been passed through this same visual treatment yet.

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
