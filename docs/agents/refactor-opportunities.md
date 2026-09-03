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
- **Checkout's refresh spinner can get stuck forever**
  (`src/hooks/useCheckoutState.ts:109-179`) - `handleRefresh` sets
  `fetchingWinners(true)`, but `loadWinners` early-returns at its own
  `if (!spreadsheetId) return;` (line 110) before ever reaching its
  `finally` block, and `handleRefresh` has no `finally` of its own to
  cover that path. Fix: move the guard inside the `try`, or wrap
  `handleRefresh` in its own `try/finally`.
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
- **`server/services/emailService.ts:processEmail` does a direct
  triple-sheet read of Bid-Management data** with no defensive parsing
  - only reachable through the already-hardened receipt-email path, so
  low urgency, but worth a look if that path is ever touched again.

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
- **`Class_AuctionItem.gs`'s constructor has no length guard on
  `rowData`** - `rowData[0].toString()` etc. assume all 12 columns are
  present; if the real Auction-Items sheet ever has fewer than 12
  populated columns, `bundleID`/`bundledDateTime` become `undefined`
  instead of `""`, silently breaking the `=== ''` fallback checks in
  `getDisplayValue()`/`getDisplayOpeningBid()`/`getDisplayMinRaise()`.
  Low probability (the app always writes all 12 columns), not fixed -
  flagged for awareness if this class is touched again.

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

Nothing outstanding right now - every gap and SHALLOW/CIRCULAR/SMOKE-rated
test flagged in this section has been closed. See `CHANGELOG.md` for the
individual fixes.

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
