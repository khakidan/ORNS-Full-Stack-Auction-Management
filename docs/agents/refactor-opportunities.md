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

- **`useConfigSettingsState.ts:43-46` syncs a prop into local state via
  `useEffect`, the exact anti-pattern shape `react-patterns.md`'s
  "Derived State" rule warns against**: `const [config, setConfig] =
  useState<Config>(remoteConfig)` followed by `useEffect(() =>
  setConfig(remoteConfig), [remoteConfig])`. Not a drop-in `useMemo`
  fix, though - `config` is a mutable local *draft* (`setConfig` is
  also called directly by every field's `onChange` while editing), not
  pure derived data, so this needs a real
  design decision (e.g. reset the draft via a `key` prop on remount, or
  only reconcile on a real external change vs. a same-value re-render)
  rather than a mechanical refactor. `refactor-opportunities.md`'s own
  "Passed Audit Inspection" list previously claimed "no component syncs
  a computed value into a second `useState` via an effect" - that claim
  is now corrected below rather than left contradicting this entry.
- **`AuctionItemsTable.tsx:64-85` uses inline `style={{ width: "..." }}`
  on all 8 `<TableHead>` cells**, alongside a separate `className` on
  each - `style_guide.md`'s "Inline style attributes are forbidden" rule
  is violated outright here, and it's the only real hit anywhere in
  `src/` outside test files. All 8 values are static (`"40px"`, `"7%"`,
  `"30%"`, `"15%"` ×3, `"18%"`, `"60px"`), not computed at runtime, so
  there's no runtime-value reason they can't move into `className` as
  Tailwind width utilities (`w-10`/`w-15` for the two px values; the
  percentages have no clean default-scale equivalent, so those would
  stay arbitrary-bracket values, e.g. `w-[7%]`, in `className` rather
  than a separate `style` prop).

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

- **`text-[10px]`/`text-[11px]` is a widespread, repeated arbitrary
  value (8 real files in `src/components/`) sitting below Tailwind's
  smallest default step (`text-xs` = 12px).** Unlike the one-off
  arbitrary widths/heights logged under "Code quality" above, this
  isn't drift - it's used consistently enough, for the same two values,
  across enough unrelated files (badges, filter labels, table
  micro-text) that it reads as a real, already-adopted convention that
  was just never promoted to a named token. `tailwind-style-guide.md`
  doesn't currently document a `2xs`-style step. Needs a design
  decision (add `--text-2xs`/`--text-3xs` tokens to `src/index.css`'s
  `@theme inline` block the same way `--color-orns-red` was added as a
  one-off token, or confirm 10px/11px should just stay as the
  established arbitrary-value exception) - not something to
  mechanically find-and-replace without that call being made first.

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
