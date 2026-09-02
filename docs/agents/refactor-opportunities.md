# Refactor Opportunities

Running list of concrete, verified work items for this codebase - not
aspirational ideas, but things confirmed against the real code. When an
item is done, remove it from this file entirely - the paper trail for
completed work lives in [`CHANGELOG.md`](./CHANGELOG.md), not here. This
file only ever reflects the current, outstanding backlog. Net-new
feature work belongs in [`ROADMAP.md`](./ROADMAP.md) instead.

---

## Tasks To Refactor

- **Migrate `BundlingDialog.tsx`'s ad hoc confirmation dialog(s)** to the
  shared `src/components/ui/ConfirmationDialog.tsx` (`component-standards.md`).
  Check first whether "cancel" performs a real action there (the shape
  that kept `Bidders.tsx`'s pending-payment `AlertDialog` unmigrated) -
  don't assume it applies.
- **Migrate the remaining hand-rolled `{loading ? <Loader2 /> : ...}`
  busy-button pattern** to `src/components/ui/LoadingButton.tsx`
  (`component-standards.md`): `BundlingDialog.tsx`, `ConfigSettings.tsx`,
  `AddAuctionItemDialog.tsx`.
- **Lazy-load `firebase`'s init** (Firestore + Auth) behind the
  cloud-sync UI in `ConfigSettings.tsx`/`ConfigContext.tsx`
  (`performance.md`). `vendor-firebase` (450 kB raw / 106 kB gzipped) is
  the single largest chunk and isn't needed for first paint - this is
  the real next step to bring the initial JS load out of
  `performance.md`'s warning band (chunk-splitting alone didn't reduce
  it, see `CHANGELOG.md`). Consider a `rollup-plugin-visualizer`
  treemap pass first to confirm the split point.
- **Add a submitting/loading state to `AddAttendeeDialog`'s "Save
  Entry" button** (`component-standards.md`) - `handleAddSubmit` in
  `hooks/useTicketAttendeeState.ts` doesn't track one yet.
- **Decide whether to delete or keep the orphaned `/api/assistant`
  backend route** (`react-patterns.md`) - `server/routes/dataRoutes.ts`,
  `server/services/assistantService.ts`, and the 5 tests in
  `server/test/bundle.test.ts`'s "Gemini Assistant workflow" block, now
  that its only frontend consumer (`AuctionAssistant.tsx`) is deleted.

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
- **Test assertions aren't shallow placeholders where they look bare**
  (`testing-philosophy.md`) - every bare `.toHaveBeenCalled()` is either
  a `.not.toHaveBeenCalled()` negative assertion or
  `server/test/middleware.test.ts` confirming `next()` fired, neither of
  which has a meaningful payload to check.

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
