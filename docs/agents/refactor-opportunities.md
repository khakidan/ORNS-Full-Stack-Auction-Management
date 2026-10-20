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

**2026-09-07 standards + testing audit**: run once feature/UI work was
believed complete, per the user's explicit request. Same three-parallel-
pass convention as 2026-09-04 (`component-standards.md`/`patterns.md`/
`performance.md`/`react-patterns.md`/`style_guide.md`/
`tailwind-style-guide.md`/`testing-philosophy.md`, plus an explicit
"shell component" focus this time), findings spot-verified against real
code before being logged below - one pass's claim that
`AuctionItemsTab.tsx`'s config-error `CardContent` is missing the
centering classes its two siblings have was confirmed by direct read,
as was the `useWinnersData.ts` toast-rule violation and
`Checkout.test.tsx`'s missing `auctionItemsSpreadsheetId` mock field.

### Redundant/duplicated logic

Nothing outstanding right now - every item flagged in the 2026-09-07
audit's "Redundant/duplicated logic" section has been closed. See
`CHANGELOG.md` for the individual fixes.

### Code quality

Nothing outstanding right now - the `FormSection.tsx` hardcoded
`text-[11px]` finding from the 2026-09-07 audit has been closed. See
`CHANGELOG.md` for the fix.

### Test coverage gaps (`testing-philosophy.md`)

Nothing outstanding right now - both gaps flagged in the 2026-09-07 audit
have been closed (`AttendeeGuestsEditor.test.tsx`/`itemBadgeColors.test.ts`,
new files). Neither turned up a real bug - both were genuinely correct,
just untested. See `CHANGELOG.md` for the individual fixes.

### Code Hardening

**Standing principle for every `.gs` file in this app** (established while closing out Bid Management's and Items' GAS passes - see `CHANGELOG.md` for the full history): each one should either (a) receive already-resolved data from Node as a parameter and turn it into an artifact - a Doc, Slide, PDF, label, or email - and do nothing else, or (b) be a background service with no request to attach to in the first place (e.g. the PayPal sweeper, now Node-side). Nothing should be left reading a sheet itself just to make a financial decision, mutate checkout/invoice state, or resolve a data list Node could hand it directly - Node already has full Sheets API read/write access, so there's no technical reason for that split to exist. Apply this same lens to any future `.gs` audit, including the Bid Management/Items GAS "Not candidates" lists in `CHANGELOG.md`'s history if either is ever revisited. The Tickets-spreadsheet project was already brought in line with this standard (see `CHANGELOG.md`'s bidder-number-duplication fix and Code Hardening item #5) and re-confirmed by a 2026-10-19 audit - `Class_GoogleAIStudio.gs`'s `createBidderLabels` only ever receives an already-resolved bidder list from Node and turns it into the Avery 5264 label doc, with no sheet reads for business data anywhere else in the folder. That audit did find and remove one small leftover - three unused sheet-name constants (`staffTicketsString`/`ticketsString`/`sponsorString`) in `Class_GlobalVariables.gs`, dead since the class that used to read those sheets directly (`Class_BidderManager.gs`) was deleted - but turned up nothing else.

The broad hardening pass this section used to track (concurrency safety,
idempotency, error handling, validation, client-side robustness) is fully
closed - every finding from that audit (the `checkInBidderWithBid`/
Auction-Items concurrency-race fixes, the colliding "Follow-Up" sheet
schemas, the missing client-side error boundary, and the two "Minor"
findings) has been resolved. See `CHANGELOG.md` for the individual fixes.


### UI / Layout Tweaks

Nothing outstanding right now - Bidders, Items, Auction Items Database,
and Checkout were all redesigned to the Attendee List's flexible-row
visual language (see `CHANGELOG.md` for the individual fixes). The
Dashboard was evaluated for the same treatment - an Artifact mockup was
built, iterated on, and reviewed - but the user explicitly decided
against it: a pure visual reshuffle (matching Bidders/Items/Checkout's
before-state) didn't apply here, since Dashboard was never table-based
and already used Cards/badges/reasonable spacing, and the real new
content found in that pass (ticket-sales revenue, a payment-method
breakdown, an unsold-items count) wasn't judged to be worth the
development cost on its own. Not revisiting unless new information
changes that calculus. Receipts was never separately evaluated and
isn't currently flagged as needing this treatment.

---

## Passed Audit Inspection

Checked directly against the standards docs and confirmed correct -
listed so future audits don't have to re-derive this, and so nobody
"fixes" something that isn't broken.

- **No native `<select>`** outside test-mock files (`component-standards.md`) -
  every real dropdown goes through `src/components/ui/select.tsx`.
- **Winner-notification toast rule implemented correctly everywhere**
  (`patterns.md`) - the `duration: Infinity` + `"I have confirmed"`
  action pattern is present in `Bidders.tsx`, `Checkout.tsx`,
  `Dashboard.tsx` (×2), `ConfigSettings.tsx`'s analogous manual-copy
  confirmation, and (since the 2026-09-07 audit found and fixed the gap)
  `useWinnersData.ts` - the hook both Bid Entry modes actually record
  winning bids through.
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
