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
gaps, verified directly against real code (a sample independently
confirmed by hand: the bundle `minRaise` drop, the Checkout stuck
spinner, the dead `WinnerCard` loading condition, the `ConfigContext`
listener leak, the `AuctionContext` dead exports, the duplicated
`resequenceCategoryIds`, the missing OAuth `postMessage` origin check,
and the bundle double-submit race all reproduce as described below).
Sorted by severity within each area.

### Correctness bugs

- **`Class_ReceiptManager.gs`'s own `createIndividualReceipt()`/
  `createAllReceipts()` prototype methods (lines ~224/282) are now
  unreachable** - they were only ever called by the global wrapper
  functions of the same name, which were deleted as part of removing
  the now-orphaned manual-menu code (see CHANGELOG.md). Left in place
  rather than deleted in that same pass, since they're substantial,
  self-contained, UI-prompt-driven methods (not one-line wrappers) and
  weren't part of what was explicitly scoped for deletion. `ReceiptManager`
  itself stays very much alive - `GoogleAIStudio.createAllReceipts`/
  `.createIndividualReceipt` use a separate, parameterized code path on
  the same class. Needs the same outright-delete-vs-keep-as-fallback
  decision as the rest of that cleanup.
- ~~Bundle creation silently drops a manually-entered min raise~~ -
  **done.** `minRaise` was destructured out of `req.body` in
  `bundleRoutes.ts` and typed on `ProcessBundleParams`, but
  `processBundle`'s own destructure never listed it, so `cleanMinRaise`
  was always recomputed from the tier table, discarding any admin
  override with no warning. Fixed to `const cleanMinRaise = minRaise ||
  calculateMinRaise(...)`, matching how `openingBid` is already handled
  one line above. Found while fixing: `server/test/bundle.test.ts`'s
  happy-path test already sent `minRaise: "20"` in its payload but
  never asserted it (nor `value`/`openingBid`/`donor`/`itemType`)
  landed correctly in the written row - added those assertions, plus a
  new test for the no-`minRaise`-provided fallback path. That new test
  itself first failed against the *real* tier fixture with the wrong
  expected value, which exposed a second, independent bug: the same
  test file's own MSW mock checked `range.includes("Value%20Calculations")`
  against an already-`decodeURIComponent`'d string, so that branch
  could never match - the "Value Calculations" tier fixture had been
  silently unreachable in every bundle test, including the original
  happy path. Fixed the match condition too. Both fixes sanity-checked
  against reintroduced bugs before trusting them.
- **Checkout's refresh spinner can get stuck forever**
  (`src/hooks/useCheckoutState.ts:109-179`) - `handleRefresh` sets
  `fetchingWinners(true)`, but `loadWinners` early-returns at its own
  `if (!spreadsheetId) return;` (line 110) before ever reaching its
  `finally` block, and `handleRefresh` has no `finally` of its own to
  cover that path. Fix: move the guard inside the `try`, or wrap
  `handleRefresh` in its own `try/finally`.
- **`ConfigContext.tsx`'s Firestore config listener is never
  unsubscribed** (`src/context/ConfigContext.tsx:49-70`) - the
  `return () => unsubConfig()` at line 70 is returned from inside the
  `onAuthStateChanged` *callback*, whose return value Firebase ignores
  (that's not how the effect-cleanup contract works for a nested
  callback). Every sign-out→sign-in cycle stacks another live listener
  that's never torn down. Fix: hold `unsubConfig` in a variable in the
  outer scope and call it from the effect's own cleanup and before
  resubscribing. Note: `patterns.md` marks this file "do not edit" -
  raise with the user before touching it.
- ~~Bundle creation button can be double-submitted~~ - **done.**
  `executeBundle` fired `fetchWithRetry(...)` without `await`, so the
  `finally { setIsExecutingBundle(false) }` ran in the same tick,
  re-enabling the `LoadingButton`-gated "Confirm Bundle & Merge Rows"
  button immediately - and since the idempotency key is regenerated per
  call, the server couldn't dedupe a rapid double-click into two
  bundles. Fixed by awaiting the fetch inline (matching the sibling
  `handleRestoreBundle`'s already-correct shape) instead of a
  fire-and-forget `.then()/.catch()` chain. Added
  `src/hooks/useBundling.test.ts` (this hook is only ever consumed
  through `AuctionItemsTab.tsx`, and both
  `AuctionItemsTab.test.tsx`/`BundlingDialog.test.tsx` mock it wholesale,
  so none of its real logic had ever run under the test suite - tested
  directly via `renderHook`) with a deferred-promise test proving
  `isExecutingBundle` stays `true` for the whole duration of the
  request, not just until the fetch call is issued.
- **OAuth `postMessage` listener doesn't check `event.origin`**
  (`src/hooks/useApiAuthStatus.ts:24-31`, `src/hooks/useGoogleAuth.ts:12-26`) -
  both listeners trust `event.data.tokens` from any `postMessage`
  sender and persist it straight to `localStorage.google_tokens`, which
  every backend call then sends as `x-google-tokens`. Fix: `if
  (event.origin !== window.location.origin) return;` before reading
  `event.data`.
- **`WinnerCard`'s "Mark Paid" button has a permanently-dead loading
  condition** (`src/components/WinnerCard.tsx:89`) -
  `loading={processingId === \`${winner.bidderId}-pay\`}`, but
  `useCheckoutState.ts` only ever sets `processingId` to `-email` or
  `-print` suffixes (confirmed by grep - no `-pay` write exists
  anywhere). The button never shows a spinner regardless of actual
  in-flight state. Fix: wire it to the real `isSubmittingPayment` flag
  used by `PaymentMethodDialog`, or drop the dead prop.
- **New staff/sponsor attendee entries write payment fields to the
  wrong semantics** (`src/hooks/useTicketAttendeeState.ts:140-142`) -
  writes `row[16] = "Paid"` (commented "Payment Status") and `row[17] =
  "$0"` (commented "Total Paid"), but `server/services/bidderService.ts:346`'s
  canonical `fieldMapping` says the *paymentStatus* column for
  non-general sheets is R (index 17) - so this writes a dollar amount
  into the status column and a status string into an unmapped one.
  Currently masked because `src/lib/attendeeParsing.ts:45-47` hardcodes
  `paymentMethod`/`paymentStatus`/`totalPaid` to `"Comp"`/`"Paid"`/`"$0"`
  for every non-general row regardless of actual cell contents - so
  today this doesn't show wrong data, but the write is backwards
  relative to the one column any other code path (`updatePaymentStatus`)
  actually reads/writes, and would surface immediately if the parser's
  hardcoding is ever revisited. Needs a decision on which of the two
  (the hardcoding, or the write) is "correct" before fixing either.
- **Optimistic-update rollbacks restore a whole stale snapshot instead
  of reverting just the failed change** - `src/hooks/useWinnersData.ts:63-64,107-108`
  is the clearest instance: `recordWinningBid` captures
  `previousWinners`/`previousTotal` from the render closure, and on
  failure restores them absolutely. Two bids recorded in quick
  succession (before a re-render) both capture the same baseline; if
  the second fails, its rollback erases the first bid's already-committed
  change too. Same shape in `useBiddersData.ts:40/58,67/85`,
  `useCheckoutState.ts:313/372`, `useTicketAttendeeState.ts:79/100,108/120`.
  Fix: make rollbacks functional and scoped to the one entity (e.g.
  `setWinners(prev => ({...prev, [itemId]: previousValue}))`) instead
  of restoring a captured array/object wholesale.
  ~~`useAuctionItemsTableState.ts:209/299`'s `handleUpdate` instance
  fixed~~ - **done** (in scope for the Items-spreadsheet hardening
  pass; the other files above are out of scope and still open).
  Replaced its captured-whole-array `previousItems` rollback with a
  `rollbackThisRow()` closure that restores only the one row's changed
  field(s) (`value`/`openingBid`/`minRaise`, or `category`) by
  `rowIndex`, so editing two different cells in quick succession can no
  longer have one's failure wipe out the other's already-committed
  change. `executeBulkUpdate`'s own whole-array rollback (a different
  function in the same file) was deliberately left as-is - it's a
  single atomic batch operation across multiple rows, so reverting the
  whole pre-batch snapshot on failure is the semantically correct
  behavior there, not an instance of this bug.
- **`useGoogleAuth`'s auth check runs inside a `setState` updater**
  (`src/hooks/useGoogleAuth.ts:35-42`) - `checkAuth()` is called from
  within the `setAuthenticated` updater function; React (especially
  StrictMode) can invoke updaters more than once, doubling
  `/auth/status` requests. Fix: call `checkAuth()` from the interval
  body directly, not from inside a state updater.
- ~~`useAuctionItemsTableState`'s selection isn't reconciled with
  filters~~ - **done.** `selectedRows` survived filter/search changes
  and wasn't pruned, while `useBundling.ts`'s `openBundlingModal`/
  `executeBundle` re-derive the selected-items list against the
  *unfiltered* `items` array - selecting rows, changing the category
  filter, and bundling could silently include items no longer visible
  in the table. Fixed with a `useEffect` keyed on `sortedItems` that
  prunes any selected `rowIndex` no longer present in the filtered
  view; deliberately general rather than special-casing `resetFilters`
  - widening the filtered view (including via `resetFilters`) never
  removes an item from `sortedItems`, so nothing gets pruned in that
  direction, only when the view actually narrows.
- ~~`useBundling.ts`'s restore/execute handlers assume response shape
  without checking `res.ok`~~ - **done.**
  `data.ui_history_log.original_item_names.join(...)` (and the
  equivalent in `executeBundle`) threw on any response missing that
  field, turning a successful-looking non-200 response into a "Cannot
  read properties of undefined" toast instead of a real error message.
  Both now check `res.ok`/`data.error` before reading `ui_history_log`,
  with a status-code fallback message and optional-chained field
  access. Sanity-checked by reverting to the old `if (data.error)
  throw` check alone and confirming the new "not-ok-with-no-error-field"
  test failed, then reverted.
- ~~`useAuctionItems.ts` duplicates `src/lib/itemParsing.ts` and the
  two have drifted~~ - **done.** Confirmed real: `useAuctionItems.ts`
  (used only by `AuctionItemsTab.tsx`, the item-management screen) had
  its own inline header-detection parser that defaulted blank `status`
  to `""` and required `item.id && item.name`, while `parseItemRows`
  (used by `useItemsData.ts` → `AuctionContext` → Dashboard/Checkout/
  `Items.tsx`, the app-wide item list) defaults blank `status` to
  `"Active"` and only requires `item.id || item.name` - so the same
  underlying sheet data could show a different item set (and different
  status values) on the management screen than everywhere else in the
  app. Replaced the inline duplicate with `parseItemRows(data.values)`.
  Added `src/hooks/useAuctionItems.test.ts` (6 tests, via `renderHook` -
  this hook is only ever consumed through `AuctionItemsTab.tsx`, which
  mocks it wholesale, so none of its real logic had run under the test
  suite before this): the parallel items/categories/valueCalculations
  fetch on mount, a direct regression test pinning both drifted
  behaviors now matching (`status` defaults to `"Active"`, an id-only
  row is included, not dropped), the no-spreadsheetId no-op, the
  items-fetch-failure error toast, categories/valueCalculations
  failing silently without blocking items from loading, and `refresh()`.
  Sanity-checked by reintroducing the old stricter `id && name` filter
  and confirming the regression test caught it, then reverted.
- ~~`useBundling.ts` duplicates `src/lib/auctionItemPricing.ts`
  byte-for-byte~~ - **done.** `parseDollar`/`calculateAutoBids` were
  copied verbatim instead of imported (`useAuctionItemsTableState.ts`
  already imported the lib version) - now imports both from
  `@/lib/auctionItemPricing` and deletes the local copies; the one call
  site was updated to pass `valueCalculations` as the lib function's
  second parameter instead of closing over it. Also closed the
  "7 untested tier branches" gap this same file flags below: added
  `src/lib/auctionItemPricing.test.ts` (20 tests) covering `parseDollar`
  and every one of `calculateAutoBids`'s tier boundaries, both with and
  without a configured Value-Calculations table.

### Redundant/duplicated logic

- **`DocumentCreationTab.tsx` and `TicketDocumentCreationTab.tsx` are
  ~200 of ~280 lines identical** - same folder-files card, refresh
  button, and loading/empty/invalid states, differing only in the
  spreadsheetId field and endpoint/button-label map. Extract a shared
  `DocumentCreationPanel`/`FolderFilesTable`, the same way
  `SpecialWinnerField` already consolidated the analogous Dashboard
  duplication.
- **27 identical auth-guard copies** - `if (!req.session?.tokens)
  return res.status(401).json({ error: "Unauthorized" });` repeated
  verbatim across `server/routes/{setupRoutes,bundleRoutes,dataRoutes,receiptRoutes,bidRoutes,productionRoutes}.ts`.
  Currently correct everywhere, but a candidate for a small
  `requireAuth` Express middleware so a future new route can't forget
  it.
- ~~Divergent "minimum raise" fallback tables~~ - **done.**
  `itemService.ts`'s `calculateBidAmounts` fell back to a flat `$5`
  when no `valueCalculations` were configured; `bundleService.ts`'s
  `calculateMinRaise` had a hardcoded 7-tier ladder instead - adding an
  item vs. bundling one at the same value produced different minimum
  raises whenever no "Value Calculations" tab was configured.
  Extracted the shared logic (the 7-tier ladder was the correct one -
  it matches what a real "Value Calculations" tab's own default rows
  look like) into `server/utils/minRaiseHelpers.ts`'s
  `calculateMinRaiseAmount()`; both services now delegate to it. Added
  a test to `items.test.ts` proving a $500 item with no Value
  Calculations tab now gets the same `$20.00` a $500 bundle would
  (previously `$5.00`), and strengthened its happy-path test with a
  `minRaise` assertion it was missing (present in the request payload
  the whole time, just never checked).
- **`useApiAuthStatus.ts` and `useGoogleAuth.ts` independently
  duplicate the same auth-status + `OAUTH_AUTH_SUCCESS` listener flow** -
  both mount at the same time (from `AuctionContext` and `App.tsx`
  respectively), so every OAuth completion fires two `/auth/status`
  requests and two redundant `localStorage` writes. Have `useGoogleAuth`
  build on `useApiAuthStatus` (keep only its `_fallbackTokens` escape
  hatch, the one thing `useApiAuthStatus` doesn't have).
- **`useBiddersData.ts`'s `checkInBidder` and `markBidderAsProxy` are
  identical apart from one field/column** (`:46-60` vs `:73-87`) -
  collapse into one `setBidderFlag(bidder, field, column, successMessage)`.
- **Error-toast wording has drifted into three variants for the same
  optimistic-rollback situation** - most call sites say `"Failed to
  sync updates—retrying... local state reverted."`, `useTicketAttendeeState.ts:101,121`
  says `"...rolling back..."`, and `useBundling.ts:225,229` reuses the
  "local state reverted" wording for `executeBundle`, which has no
  optimistic update to revert at all, and nothing anywhere actually
  retries. Standardize on one accurate constant.
- **`ItemsSpreadsheet/menu.gs`'s custom menu is now disabled (per the
  same "app is the single source of use" policy applied to
  Bid-Management), orphaning ~12 menu-only wrapper functions** -
  `printAuctionItemsForBundling`, `requestSequentialBundles`,
  `printLabelsForAuctionItems`, `setAuctionIDsOnImportSheet`,
  `createNewBiddingGuideCoverPage`, `createNewBiddingGuideInnerPages`,
  `createBidSheets`, `createNewCatalog`, `createTableTents`,
  `createNewPresentation`, `updateFileOrFolderLocations`,
  `fixEmptyCategorySheet`. Each duplicates the same generation logic
  the corresponding `api*` bridge function in `Class_GoogleAIStudio.gs`
  already calls (different global name, its own fresh
  `new AuctionItemManager()`, no `_executeGeneration` error wrapper).
  Same deferred decision as Bid-Management's now-deleted manager
  classes: delete outright vs. keep as inert fallback - hold off until
  the Items-spreadsheet hardening plan's testing phase is done, same
  sequencing as before.

### Code quality

- **`useAttendeesData.ts` tracks no `loading` state**, unlike its
  sibling `useBiddersData.ts` - `TicketAttendeeTab.tsx`'s Refresh
  button is wired to the *bidders'* `loading` flag from context instead,
  so its spinner never reflects the actual attendee fetch. Add a
  `loading` state to `useAttendeesData` and expose/wire it correctly.
- **`useCheckoutState.ts` (416 lines) and `useAuctionItemsTableState.ts`
  (437 lines)** are both past this codebase's own "over 400 is almost
  certainly doing too much" line (`react-patterns.md`); each mixes list
  parsing/filtering with per-row and batch mutation handlers. Candidate
  for the same container-hook-split treatment already applied to every
  other oversized file in this app.
- **Several `any` types could be narrowed to `string[]`/concrete
  shapes**: `useAttendeesData.ts:34` (`rowData: any[]`),
  `AuctionContext.tsx:26` (`data: any[]`), `useAuctionItems.ts:19,35,79`
  (`row: any[]`), `useCheckoutState.ts:117` (`row: any`, where
  `name: row[0]` can be `undefined` while typed `string`),
  `useBiddersState.ts:105-106` (`valA`/`valB` typed `any`, silently
  unsorted for any sort key other than `id`/`name`/`status`).
- **`useConfigSettingsState.ts`'s `syncSettingToCloud` never checks
  `res.ok`** (`:28-35`) - the six calls at `:229-234` report success
  via the outer `handleSave` even on a 4xx response, since
  `fetchWithRetry` only throws for 429/5xx.
- **Icon-only interactive elements hidden via `opacity-0
  group-hover:opacity-100` have no keyboard-focus reveal** -
  `src/components/ui/EditableCell.tsx:137-149`'s edit-trigger (used in
  nearly every editable table cell app-wide) and the delete button in
  `src/components/AuctionItemRow.tsx:150-158` are invisible to a
  keyboard user tabbing to them, with no visible focus ring since
  `opacity-0` hides the whole element. `component-standards.md`
  requires focus outlines never be removed without replacement. Fix:
  add `group-focus-within:opacity-100` alongside the existing
  `group-hover:opacity-100`.
- **`Checkout.tsx`'s two `TabsContent` panels both bind the same
  `state.filteredWinners`** (`:84-106`) - `useCheckoutState.filteredWinners`
  is already tab-scoped internally, so passing the identical prop to
  both the "pending" and "completed" `WinnerGrid` instances only
  renders correctly because `Tabs` unmounts the inactive panel. Fragile
  if `forceMount` is ever added. Fix: expose separate
  `pendingFilteredWinners`/`completedFilteredWinners` from the hook.
- **`AddAttendeeDialog.tsx` and `BiddersFilterControls.tsx`'s `Select`s
  render bare `<SelectValue />` where the stored value and display
  label differ** (e.g. value `"sponsor tickets"` shown as "Sponsor") -
  `component-standards.md` documents this exact failure mode
  (`SelectValue` renders the raw value unless given explicit
  `children`) and the documented workaround isn't applied at either
  call site. Medium confidence - couldn't be confirmed statically since
  it depends on `@base-ui/react`'s item-registration timing; verify
  with a manual UI check (select "Sponsor"/"Checked In" and confirm the
  trigger text) before fixing.
- **`google-api.ts`'s `fetchWithRetry` mutates the caller's `options`
  object in place** (`src/services/google-api.ts:27-38`) - shallow-clones
  neither `options` nor `options.headers` before injecting the auth
  header, so a caller reusing an options literal across calls
  accumulates state. Fix: clone before mutating.

### Test coverage gaps (`testing-philosophy.md`)

Zero test file imports the real module (not a `vi.mock()` of its path)
for any of these - confirmed by grep. Ranked by risk:

- **`src/lib/attendeeParsing.ts`** - the dual general-vs-staff/sponsor
  column-shift logic (the exact area the correctness bug above lives
  in). Highest-risk untested file in the repo.
- **`src/lib/itemParsing.ts`** - header-name detection via substring
  `.includes()` matching with positional fallbacks; one drifted header
  name silently binds the wrong column.
- **`src/hooks/useWinnersData.ts`** - the column-pair parse itself is now
  covered via `src/lib/bidGridParsing.test.ts`, but `fetchWinners`'s
  bidder-name lookup and `recordWinningBid`'s optimistic-update/rollback
  path around `totalRaised`, the app's headline number, remain untested.
- **`src/hooks/useAttendeesData.ts`** - add/remove optimistic update +
  rollback, plus its own hardcoded column indices.
- **`src/context/ConfigContext.tsx`** - Firestore snapshot→localStorage
  mirroring, the `permission-denied` toast branch, and the `@orns.org`
  domain-enforcement + forced-signout logic. Security-relevant, zero
  coverage.
- **`src/lib/bidderAttendeeInfo.ts`** - primary-vs-guest name/email
  matching that drives the pending-check-in badge logic.
- Lower priority but real gaps: `useConfigSettingsState.extractId`
  (4 regex branches, only ever exercised with pre-clean input in the
  existing test), `useAuctionItems.ts`, `useApiAuthStatus.ts`/`useGoogleAuth.ts`.
  (`src/lib/auctionItemPricing.ts` closed - see the Items-spreadsheet
  hardening entries above.)

Existing tests that would rate SHALLOW/CIRCULAR/SMOKE under
`testing-philosophy.md`'s own definitions, with the fix each needs:

- `src/components/ConfigSettings.test.tsx:141-157` - asserts one field
  (`ticketPrice`) out of nine that `handleSave` normalizes; fixture IDs
  are already clean so `extractId`'s branches never fire. Needs an
  assertion on a URL-shaped input and its extracted ID.
- `src/components/Checkout.test.tsx:114-119,139-144` - asserts only
  `expect.objectContaining({ method: "POST" })`, never the request
  body; the file's own `:170-176` shows the right pattern
  (`body: expect.stringContaining(...)`) - apply it here too.
- `src/components/Receipts.test.tsx:86` - uses `expect.anything()`,
  the literal placeholder `testing-philosophy.md` calls out as not a
  real assertion.
- `server/test/production.test.ts:96-97` - asserts an Apps Script
  function was called and how many times, never with what arguments.
- `src/components/BundlingDialog.test.tsx:83-96` - two tests assert the
  identical three `getByDisplayValue` calls on props handed in one line
  earlier; the first is mistitled "renders the dialog title and
  description" but never checks the description.
- `src/components/Bidders.test.tsx:60-61` - mocks `AlertDialogCancel`/`AlertDialogAction`
  as `({children}) => <button>{children}</button>`, dropping `onClick`
  entirely - any future test clicking a confirm button in this file
  will silently no-op and still pass.

**Planned sequence: hardening every remaining Bid-Management API call**
(2026-09-02). The checkout/PayPal payment workflow (`recordPayment`,
`checkPendingPayPalInvoices`, `PayPalService`, receipt generation via
`ReceiptManager`, and the winners/bid-grid parsing in
`useCheckoutState.ts`/`useWinnersData.ts`) is already fully audited and
hardened - see CHANGELOG.md. This is the follow-on plan for everything
else that talks to the Bid-Management spreadsheet, in the order it'll
be worked through:

1. ~~`server/services/auctionSetupService.ts:196-233`'s year-end reset~~ -
   **done.** Fixed a real gap found while writing the tests: every
   failure in step 6 (delete/clear/update against the master
   spreadsheets) only reached `console.error`, invisible in the actual
   setup-wizard UI, while the template-copy and spreadsheet-backup steps
   right above it already surfaced failures via `onLog` - now all of
   step 6 does too, so a failed Bid-Management reset (quota error,
   permissions, etc.) shows up in the streamed log instead of silently
   leaving stale data in a spreadsheet the operator was told was reset.
   `server/test/auction-setup.test.ts` now pins the exact
   `batchUpdate`/`clear`/`update` payloads (which sheetIds get deleted
   and which don't, e.g. `Auction-Status`/`tickets` must survive) and
   asserts the failure-visibility fix via a simulated 429.
2. ~~`src/hooks/useBiddersData.ts`'s `checkInBidder`/`markBidderAsProxy`~~
   - **done.** `useBiddersData` is only ever consumed through
   `AuctionContext.tsx`, which every existing component test mocks
   wholesale - there was no component-test path that could reach this
   hook's real code. Added `src/hooks/useBiddersData.test.ts` (7 tests)
   via `renderHook` from `@testing-library/react` v16 (already installed,
   first use of it in this codebase - the established integration-style
   component-test convention has no way to reach hook logic this
   deeply hidden behind a fully-mocked context; confirmed with the user
   before introducing the new pattern). Covers: `fetchBidders` happy
   path and its swallow-to-empty-list failure path; `checkInBidder`'s
   real column-E write at the bidder's actual sheet row plus rollback
   when the bidder isn't found in the `A:A` lookup and when the write
   itself fails; the equivalent for `markBidderAsProxy`'s column-F
   write, including a check that rolling back one bidder doesn't touch
   a sibling bidder's already-true `isProxy` state. One assertion had to
   be dropped after it flaked: asserting the optimistic update landed
   *before* the rollback is not reliably observable when both the
   optimistic set and the mocked rejection resolve on immediate,
   same-tick microtasks - only the settled end state is pinned now.
   Sanity-checked all 7 catch a real regression (temporarily
   commented out both `setBidders(previousBidders)` rollback calls,
   confirmed 3 tests failed, reverted) and re-ran 5x to confirm no
   flakiness before trusting them.
3. ~~Verify `bidRoutes.ts`'s transactional multi-sheet writes are
   actually well-tested, not just tested~~ - **done.** Rated all four
   against `testing-philosophy.md`'s GOOD/SHALLOW/CIRCULAR/SMOKE
   criteria. `recordWinningBid`'s test was fine on inspection - the real
   write is a single `[[itemId, price]]` row, so its
   `arrayContaining` assertion is nearly exact for that shape, not
   loose. `registerWalkInBidder` already asserts specific
   field-by-field payload values. `checkInBidderWithBid`'s own describe
   block in `bid-management.test.ts` is just a 401 auth check, but its
   real happy-path coverage lives in `tickets.test.ts`'s "Ticket
   Payment Status workflow" (asserts the actual ticket-bid write
   payload) - a confusing split across two files, but not an actual
   coverage gap. `closeAuctionAndCleanup` was the one real SHALLOW
   test: it only asserted `updateCallCount >= 1`, and its own mock data
   didn't even give the "winner" bidder a real win (the win indicator
   was placed under the `Price` column instead of the bidder-ID
   column), so the test would have passed identically whether or not
   the winner-exclusion logic worked at all. Replaced with 2 tests
   using a corrected 4-bidder dataset (winner / non-winner / never-
   checked-in / already-checked-out) that pin the exact `count` in the
   response and the exact `values.batchUpdate` payload (which row,
   which range, which bidders excluded and why). Added a
   `valuesBatchUpdateRequests` capture array to `handlers.ts` for this
   endpoint (`sheets.spreadsheets.values.batchUpdate`, distinct from
   the sheet-structural `spreadsheets.batchUpdate` captured for item 1
   above - same-looking URL pattern, different Sheets API endpoint).
   Sanity-checked the new tests catch a real regression (temporarily
   dropped the `!winnersSet.has(id)` exclusion, confirmed the count
   assertion failed, reverted).
4. ~~`src/hooks/useDashboardState.ts`'s Special-Winners/Follow-Up
   read+write~~ - **done.** `fetchFollowUpRecords`, the `Special-Winners`
   fetch effect, `saveGiftCardWinner`, `saveRaffleWinner`. Unlike
   `useBiddersData.ts` (item 2), this hook is NOT hidden behind a
   fully-mocked context in `Dashboard.test.tsx` - only its
   `@/services/google-api` dependency is mocked, so the real hook code
   already ran under the existing tests, just unexercised past the
   initial mount effect. Added 8 tests directly to `Dashboard.test.tsx`
   (no new `renderHook` file needed): loading and resolving an existing
   Special-Winners bidder ID's name on mount; saving a winner who hasn't
   checked out (writes `Special-Winners!B2`/`B3` only); saving one who
   *has* checked out (also appends a `Follow-Up!A:C` row, fires the
   checked-out warning toast, and re-fetches the follow-up list);
   the bidder-not-found error path; the write-failure error path; and
   the "Refresh Lists" button re-fetching and rendering real Follow-Up
   records. Found and fixed a real bug while writing these: the
   already-logged "Not Present" pie-slice finding (below in "Passed" -
   moved here) - `bidderStats`'s `totalBidders - checkedInCount` double-
   counted proxy bidders as "absent" even though the sibling
   `unattendedBidders` list one line away correctly excludes them; fixed
   by subtracting `proxyBidders.length` too, and updated the one
   existing `Dashboard.test.tsx` assertion that had been pinning the
   buggy value (`"Not Present: 4"` → `"Not Present: 3"` for the file's
   10-bidder/1-proxy mock fixture - confirmed by temporarily reverting
   the fix and watching that exact assertion fail before trusting the
   new value). Sanity-checked the new Follow-Up tests catch a real
   regression too (temporarily disabled the checked-out-bidder
   `appendSheetData` call, confirmed the relevant test failed, reverted).
5. ~~`src/hooks/useAuctionStatusData.ts`~~ - **done, and this closes out
   the whole Bid-Management hardening plan.** Same situation as item 2
   (`useBiddersData.ts`): only ever consumed through `AuctionContext.tsx`,
   which every component test mocks wholesale, so no component-test path
   reached this hook's real code. Added
   `src/hooks/useAuctionStatusData.test.ts` (13 tests) via `renderHook`,
   the same pattern already established for item 2. Covers
   `fetchAuctionStatus`'s `val === false || val === "FALSE"` coercion
   with a parametrized case for each real cell shape it can see
   (boolean `false`, string `"FALSE"`, boolean `true`, string `"TRUE"`,
   and the never-actually-matching lowercase `"false"`, which the sheet
   never writes but is worth pinning since a case-sensitivity slip here
   would silently gate the entire post-auction UI), plus the no-
   spreadsheetId/fetch-failure/empty-values no-op paths; and
   `requestCloseAuction`'s success path (with and without a non-zero
   `count`, which gates a second toast), the server-error and network-
   throw failure paths (both must return `false` and leave
   `isAuctionClosed` untouched, not just toast), and the no-spreadsheetId
   short-circuit. Sanity-checked before trusting: temporarily loosened
   the coercion to just `val === false` (dropping the `"FALSE"` string
   case) and confirmed exactly the one relevant parametrized case
   failed, reverted.

Also flagged during the inventory but deliberately left out of this
sequence: `server/services/emailService.ts:processEmail` does a direct
triple-sheet read of Bid-Management data, but it's only reachable
through the already-hardened receipt-email path - worth a defensive-
parsing look eventually, not urgent enough to block this list.

**Planned sequence: hardening the Items-spreadsheet API surface**
(2026-09-03). Now that the Bid-Management plan above is fully closed,
this is the same treatment applied to `scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/`
(26 `.gs` files, 8 `api*` bridge functions all called from
`server/routes/productionRoutes.ts` → `DocumentCreationTab.tsx`) and
its Node-side callers. Order: fix real bugs found during the read-
through first, then build the two-tier test infrastructure (Node `vm`
harness + native GAS tests, same `overrides = {}` injectable-dependency
pattern used for Bid-Management), then close the Node-side gaps.

1. ~~Fixed a critical, complete breakage~~ - **done.** `Class_GlobalStyles.gs`
   was entirely empty (0 bytes), but `Class_DriveService.gs`'s
   `DriveService extends GlobalStyles` - since `DocService`, `SlidesService`,
   and `TemplateManager` all extend `DriveService` transitively, and
   every document generator extends one of those, this would have
   thrown `ReferenceError: GlobalStyles is not defined` the instant
   *any* function in the script ran (menu items and all 8 `api*`
   bridge functions alike). User pasted in the real content (colors,
   fonts, spacing primitives, `DocumentApp` style objects - the same
   shape as the sibling `BidManagementSpreadsheet/Class_GlobalStyles.gs`).
2. ~~`LiveAuctionSlides.writeLiveAuctionItems_()` and
   `BiddingGuideDoc.loopThroughAllLiveAuctionItems_()` didn't filter
   inactive/deleted items~~ - **done.** Both looped over raw sheet rows
   via `getAuctionItemAtIndex_(i)` instead of calling
   `getValidSortedItems()` like every other document generator
   (`BundlingMeetingDoc`, `PackagingLabelsDoc`, `BidSheetDoc`,
   `CatalogDoc`, `TableTentDoc` all correctly filter+sort). A Live-
   category item marked inactive/deleted in the app would still print
   in the live-auction slideshow and the bidding guide's inner pages.
   Fixed both to build their item list via
   `this.itemManager.getValidSortedItems().filter(item => item.isLive())`.
3. ~~`GlobalVariables`'s `_Settings`-missing path called
   `SpreadsheetApp.getUi().alert(...)` unconditionally~~ - **done.**
   `getUi()` throws when there's no UI context, which is exactly how
   every `api*` call reaches this code (via the Apps Script API, no
   spreadsheet window open) - if `_Settings` were ever missing, the
   caller would get a confusing internal UI-context exception instead
   of the intended "Missing _Settings configuration" message. Wrapped
   the `getUi().alert(...)` call in a try/catch that swallows the no-
   UI-context failure; the deliberate `throw new Error(...)` right
   after it still surfaces the real message either way.
4. ~~Disabled the Items spreadsheet's custom "Auction" menu~~ - **done.**
   Per the user's explicit confirmation that the same "app is the
   single source of use, spreadsheet menus are not used anymore"
   policy applied to Bid-Management also applies here - `onOpen`/
   `onInstall` are now no-ops, `createCustomMenu()` is left defined
   (just unreachable) as a manual fallback, matching
   `BidManagementSpreadsheet/menu.gs` exactly. All 8 menu-only document-
   generation wrapper functions (`printAuctionItemsForBundling`,
   `requestSequentialBundles`, `printLabelsForAuctionItems`,
   `setAuctionIDsOnImportSheet`, `createNewBiddingGuideCoverPage`,
   `createNewBiddingGuideInnerPages`, `createBidSheets`,
   `createNewCatalog`, `createTableTents`, `createNewPresentation`,
   `updateFileOrFolderLocations`, `fixEmptyCategorySheet`) are now
   orphaned the same way Bid-Management's manager classes were -
   logged as a new follow-up below (deleting them is a later decision,
   same deferred sequencing as the Bid-Management cleanup).
   Sanity-checked all 4 fixes by loading the full `.gs` folder (in
   correct dependency order) into a sandboxed Node `vm` context and
   confirming every file parses and every `extends` chain resolves with
   no errors - not a full test run, just confirming nothing was broken
   syntactically before moving on to real test infrastructure.
5. ~~Build the two-tier test infrastructure for the 8 `api*` bridge
   functions~~ - **done, with a deliberate scope decision.** Applied the
   same `overrides = {}` injectable-dependency pattern used for
   Bid-Management to `Class_GlobalVariables.gs` (`activeSpreadSheet`/
   `config`, including the same "guard `getUi()` in API context" fix
   already applied to Bid-Management's copy), `Class_AuctionItemManager.gs`
   (forwards overrides to `super()`), and `Class_GoogleAIStudio.gs` (new
   `itemManager` override, replacing the lazily-constructed
   `new AuctionItemManager()` outright). Extended the shared
   `server/test/helpers/fakeSheet.ts` (used by both scripts now) with
   `getLastRow()`/`getLastColumn()` and the bounded multi-row/col
   `getRange(row, col, numRows, numCols)` form `AuctionItemManager`
   needs - `FakeSheet` previously only supported single-cell
   `getRange(row, col)`. Built both tiers for the **data layer only**
   (`AuctionItemManager.getValidSortedItems()`, `AuctionItem`'s
   display-fallback helpers, and `GoogleAIStudio._executeGeneration`/
   `itemManager` - exactly where the Live-item-filtering bug lived and
   where a regression would silently corrupt every generated document):
   `server/test/gs-items-auction-item-manager.test.ts` (10 tests) and
   `server/test/gs-items-google-ai-studio.test.ts` (5 tests) on the Node
   side, `scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/AuctionItemManager_UnitTests.gs`
   (`runItemsSpreadsheetUnitTests`, 10 tests) as the native tier - the
   user should run it once from the editor after copying it over.
   **Deliberately NOT covered**: the 8 `create*` methods' actual document
   output. Each constructs a real `DocumentApp`/`SlidesApp`/`DriveApp`-
   backed generator with long chains of builder calls
   (`insertParagraph().setHeading().setAlignment().setAttributes()...`,
   `insertShape().getText().setText().getTextStyle()...`) across 7
   different generator classes; faithfully faking that whole surface was
   judged not worth the effort versus the safety it buys, the same
   scoping call already made for Bid-Management's `ReceiptDoc`. Every
   test file was executed against the real combined source in Node
   before being trusted, and each new/changed assertion was sanity-
   checked against a deliberately reintroduced bug before being trusted
   (the `'inactive'`-only status filter, `_executeGeneration` re-
   throwing instead of catching) - both caught cleanly, then reverted.
   Test count: 408 → 423 (275 → 290 backend); updated the count
   everywhere it's asserted. **Reference-copy work only - needs to be
   manually copied into the live Apps Script editor before the native
   test file can run there** (`Class_GlobalVariables.gs`,
   `Class_AuctionItemManager.gs`, `Class_GoogleAIStudio.gs`,
   `AuctionItemManager_UnitTests.gs`). `tsc --noEmit` clean; full suite
   423/423, `npm run build` clean.
6. ~~Close the Node-side gaps once the `.gs` side is testable~~ -
   **done, closing out the whole Items-spreadsheet hardening plan.**
   `server/test/production.test.ts`'s happy-path tests now assert
   `lastAppsScriptParams` matches the real `folderId` sent (previously
   only checked "was the function called"), and 2 new tests cover
   `productionRoutes.ts`'s `result.success === false` → 400 branch
   (distinct from the already-tested `response.data.error` → 500 branch
   - the Apps Script execution itself can succeed while the function's
   own return value is a business-logic failure) and its missing-
   `scriptId` → 400 branch, both previously untested. Added
   `src/components/DocumentCreationTab.test.tsx` (16 tests, zero
   coverage before this) - the file-list fetch on mount and its
   not-configured/404/other-error paths, the Refresh button, all 8
   generation buttons individually parametrized (button text, real
   endpoint, `functionName` used as the toast id, and the toast's label
   text, since the toast message differs from several buttons' visible
   text - e.g. "Create Item Labels Document" the button vs. "Create
   Item Labels" the toast), the auction-closed disabling, the server-
   side generation-failure error toast, and the missing-Items-
   spreadsheet-ID guard. Every new/changed assertion sanity-checked
   against a deliberately reintroduced bug before being trusted (the
   `success: false` → 400 branch, the missing-`scriptId` guard, the
   `folderId` payload, the auction-closed `disabled` prop) - all caught
   cleanly, then reverted. Test count: 423 → 441 (290 → 292 backend,
   133 → 149 frontend); updated the count everywhere it's asserted.
   Purely Node/React test additions - no `.gs` files touched, so
   nothing needs copying to the live script for this item. `tsc
   --noEmit` clean; full suite 441/441, `npm run build` clean.

Missing edge-case coverage on business-critical flows that already have
*some* test coverage:

- **Bidder check-in** - `Bidders.test.tsx` has 21 tests and none click
  "Check In." The pending-payment confirm path, the
  `/api/auction/check-in-with-bid` call, its `bidValue: parseFloat(ticketPrice)
  || 35` fallback, and the failure/rollback path are all untested.
- ~~Bundle create/restore~~ - **done, closing the last item of the
  Items-spreadsheet direct-Sheets-API plan.** Thorough server-side
  coverage already existed (`server/test/bundle.test.ts`); the real
  gap was `useBundling.ts`'s own logic (the `<2`-items guard, the
  double-submit/`res.ok` fixes, AI-suggestion fallbacks,
  `handleRestoreBundle`) and its wiring into the actual UI, since both
  `AuctionItemsTab.test.tsx` and `BundlingDialog.test.tsx` mock
  `useBundling` wholesale. `useBundling.test.ts` (added earlier in this
  same plan, via `renderHook`) already closed the hook-logic half;
  `BundlingDialog.tsx` was already well-covered directly as a pure
  presentational component (it renders from props alone, no `useBundling`
  import). What was still missing was specifically the *wiring*: does
  selecting real rows in the real table and clicking through the real
  UI actually reach `useBundling` and produce the right request. Added
  `src/components/AuctionItemsTab.bundling.test.tsx` (4 tests,
  `useBundling` deliberately left unmocked, unlike the sibling
  `AuctionItemsTab.test.tsx`): selecting 2 real rows shows the real
  bulk-action-bar count, clicking "Bundle" opens the real dialog
  pre-filled with the real merged donors/computed auto-bids, confirming
  sends the real request with the selected items' actual IDs and the
  typed name, and the `<2`-items guard blocks opening the dialog with a
  real toast. Hit and fixed a real test-authoring pitfall along the
  way: the shadcn/`@base-ui/react` `Checkbox` re-renders its DOM node
  on each state change, so capturing `screen.getAllByRole("checkbox")`
  once and clicking two entries from that same stale array silently
  no-ops on the second click (confirmed by adding a temporary debug log
  to the pruning effect from the previous item and watching it never
  fire a second time) - fixed by re-querying fresh
  (`screen.getAllByRole("checkbox")[n]`) immediately before each click,
  and using `fireEvent.click` instead of `userEvent.click` for these
  specific base-ui elements. Sanity-checked by breaking the real
  `AuctionItemsTab.tsx` → `useBundling` wiring (passing `{}` instead of
  `table.selectedRows`) and confirming exactly the wiring-dependent
  tests failed, then reverted.
- **PayPal surcharge** - `financeUtils.test.ts` covers $0/$5/$100/$10,000
  with exact penny math, but not a negative input;
  `calculatePayPalSurcharge(-1)` currently returns a negative total
  with a positive surcharge with no guard. Given `AGENTS.md` names this
  the single authoritative fee path, worth a guard + test.

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
- **No derived-state duplication anti-pattern** (`react-patterns.md`) -
  no component syncs a computed value into a second `useState` via an
  effect.
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

Nothing outstanding right now. Items belong here only when they
genuinely need a decision, doc correction, or environment this audit
doesn't have access to - not as a place to defer real code fixes.

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
