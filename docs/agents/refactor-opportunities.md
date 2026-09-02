# Refactor Opportunities

Running list of concrete, verified work items for this codebase - not
aspirational ideas, but things confirmed against the real code. When an
item is done, remove it from this file entirely - the paper trail for
completed work lives in [`CHANGELOG.md`](./CHANGELOG.md), not here. This
file only ever reflects the current, outstanding backlog.

This file absorbed [ROADMAP.md](./ROADMAP.md)'s former "Frontend UI
Audit & Component Unification Plan" section - `ROADMAP.md` keeps only
forward-looking feature milestones now; refactor items belong here.

**2026-09-02 audit**: a full pass against
[`component-standards.md`](./component-standards.md),
[`patterns.md`](./patterns.md), [`performance.md`](./performance.md),
[`react-patterns.md`](./react-patterns.md), [`style_guide.md`](./style_guide.md),
[`tailwind-style-guide.md`](./tailwind-style-guide.md), and
[`testing-philosophy.md`](./testing-philosophy.md) against the real
`src/`/`server/` code. Findings are sorted into three sections below:
things that need code changes, things that were checked and are already
correct, and things that need fixing but aren't a code refactor (a
decision, a doc correction, or an environment fix).

---

## Tasks To Refactor

Concrete, actionable code-level work - each item below was confirmed
directly against the file it names, not estimated.

### Shared component follow-ups (`component-standards.md`)

Every component originally flagged as missing here has been resolved:
`FilterToolbar`, `DataTableWrapper`, `StatusStatePlaceholder`,
`LoadingButton`, `IconButton`, and `ConfirmationDialog` were built and
adopted at their named call sites; `AttendeeLookupCard` turned out not
to apply (no real duplicated card markup existed to consolidate - see
`CHANGELOG.md`) and was dropped rather than force-built. What's left
below is real, verified follow-up adoption at sites beyond the original
scope - not new components to build.

`src/components/ui/ConfirmationDialog.tsx` exists (a shared confirmation
dialog, adopted by `AuctionItemsTab.tsx` and, as of `Checkout.tsx`'s
refactor, its "Print All Receipts"/"Email All Winners" confirms too -
which also picked up an `isLoading` state on their confirm buttons that
the original hand-rolled dialogs never had) but other ad hoc
confirmations - e.g. in `BundlingDialog.tsx` - still haven't been
migrated. Worth doing opportunistically. `Bidders.tsx`'s pending-payment
`AlertDialog` was deliberately *not* migrated (see `CHANGELOG.md`) -
its "No, Do Not Add" button performs a real action, not just a close, so
it doesn't fit `ConfirmationDialog`'s cancel-just-closes API. Any future
migration should check for that same shape before assuming it applies.

`src/components/ui/LoadingButton.tsx` now exists too (`loading`/
`loadingText`/`icon`/`loaderClassName` props, wraps `Button`), adopted in
`BidEntry.tsx`, `Bidders.tsx`, and `Checkout.tsx` - the doc's original
named scope for this item, though `Receipts.tsx` turned out not to apply
(its refresh button already used a different, correct "spin the same
icon in place" pattern, not a `Loader2` swap - that claim was stale).
While migrating, found the identical hand-rolled `{loading ? <Loader2
.../> : ...}` pattern repeated well beyond those four files. Also
adopted in `Dashboard.tsx`'s two Special Winners save buttons during
that file's own refactor; `TicketAttendeeTab.tsx` turned out not to need
it after its own refactor either - its one text-label busy button (the
"Confirm Delete" dialog) was replaced by `ConfirmationDialog` instead
(which handles loading internally), and its remaining `Loader2` usage is
an icon-only inline save button with no label to swap, which fits
`IconButton`'s `icon` prop, not `LoadingButton`. Still open in
`BundlingDialog.tsx`, `ConfigSettings.tsx`, and `AddAuctionItemDialog.tsx`,
worth a dedicated follow-up pass rather than folding into this one,
since it touches three more files.

### Architecture: `src/lib/` mixes pure and impure code (`react-patterns.md`)

`categoryHelpers.ts` and `utils.ts` are genuinely pure; `google-api.ts`
(network calls, `localStorage`, retry/backoff) and `firebase.ts` (live
SDK client init) are not. There is no `src/services/` directory, so the
`lib -> services -> hooks -> components` layering described in
`react-patterns.md` doesn't fully exist on the frontend yet (it does
exist, correctly, on the Express backend). Consider either formalizing a
`src/services/` split or explicitly documenting `lib/` as "pure
utilities + integration clients."

### The `vendor-utils` build chunk is oversized (`performance.md`)

Found while re-measuring bundle size for `style_guide.md` (see that
doc's Bundle Optimization section for the full real numbers, from a
verified `npm install && npm run build` run on 2026-09-02). The
catch-all `vendor-utils` chunk in `vite.config.ts`'s `manualChunks` is
851 kB raw / 238 kB gzipped - by far the largest chunk in the app, and
the main reason the initial JS load (~421 kB gzipped total) sits in
`performance.md`'s own "warning" band. It sweeps in every dependency
that isn't `react`/`recharts`/`motion`/`lucide-react`, including two
genuinely substantial libraries - `firebase` (auth + Firestore SDK) and
`@base-ui/react` (this app's entire UI primitive library). Giving those
two their own named chunks in `manualChunks` (the same pattern already
used for `vendor-react`/`vendor-recharts`/`vendor-motion`/`vendor-lucide`)
would let the browser cache them independently and make it obvious in
future builds which dependency is driving bundle growth. A full
treemap pass (`rollup-plugin-visualizer`, installed temporarily per
`performance.md`'s own guidance) would confirm the exact split before
committing to specific new chunk boundaries.

### `AuctionAssistant.tsx` is never imported anywhere (`react-patterns.md`)

`src/components/AuctionAssistant.tsx` exists (it arrived via the
GitHub-history merge, not written for this local checkout) and pulls in
`react-markdown`, but a repo-wide search found no import of it from
`App.tsx` or any other component - it is dead code today. Either wire it
into the app (it looks like an AI chat-assistant panel, consistent with
`metadata.json`'s `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` capability
and the real `server/services/assistantService.ts` backend it would
presumably call) or delete it; leaving an unreferenced component with a
real dependency (`react-markdown`) sitting in the tree is confusing for
the next person who greps for it expecting it to be live.

### Two different `EditableCell` implementations (`component-standards.md`)

`src/components/ui/EditableCell.tsx` (shared, `type: "text" | "textarea" | "select"`,
Save + Cancel buttons) and `src/components/AttendeeEditableCell.tsx`
(single-line only, Save button + Escape-to-revert, no Cancel button) are
two genuinely different implementations of the same "click to edit
inline" concept, found while splitting up `TicketAttendeeTab.tsx` (the
latter used to be a local, file-scoped component there). Not merged now
since reconciling their different Cancel/Escape behavior is a real
design decision, not a mechanical extraction - flagged here rather than
guessed at.

### `AddAttendeeDialog`'s "Save Entry" has no loading state (`component-standards.md`)

Found while splitting up `TicketAttendeeTab.tsx`. Unlike `Checkout.tsx`'s
confirm dialogs (fixed in that file's own refactor - see `CHANGELOG.md`),
this one's underlying handler (`handleAddSubmit` in
`hooks/useTicketAttendeeState.ts`) doesn't track a submitting state at
all yet, so there's no existing state to wire up - a real gap to close,
not just a wiring fix.

---

## Passed Audit Inspection

Checked directly against the standards docs and confirmed correct as of
this audit - listed so future audits don't have to re-derive this, and
so nobody "fixes" something that isn't broken.

- **No native `<select>` in real components** (`component-standards.md`).
  A repo-wide search found native `<select>` only inside test-mock files
  (`*.test.tsx`); every real dropdown goes through
  `src/components/ui/select.tsx`.
- **Winner-notification toast rule implemented correctly** (`patterns.md`).
  The `duration: Infinity` + `"I have confirmed"` action pattern for a
  checked-out bidder winning an item is present and correct in
  `Bidders.tsx`, `Checkout.tsx`, `Dashboard.tsx` (two call sites), and
  the analogous manual-copy confirmation in `ConfigSettings.tsx`.
- **Bundle restoration and category re-sequencing implemented correctly,
  and server-side** (`patterns.md`). `server/services/bundleService.ts`
  correctly sets a restored bundle row to `"Inactive"`, clears its
  sequential ID, and calls `resequenceCategoryIds()` on both the
  create-bundle and restore-bundle paths - matching the rule exactly, and
  correctly kept out of client code.
- **PayPal surcharges never calculated client-side** (`patterns.md`).
  No surcharge percentage, flat fee, or related math was found anywhere
  in `src/`; it lives only in `server/services/paypal.ts` /
  `server/utils/financeUtils.ts` via `PayPalService.calculatePayPalSurcharge`.
- **Session cookie name is `orns_session`, not `__session`**
  (`patterns.md`), confirmed in `server/app.ts` and
  `server/routes/authRoutes.ts`.
- **`vite.config.ts`'s `manualChunks` is the required functional
  matcher**, not a static object map (`patterns.md`, `performance.md`).
- **Route-level `React.lazy()` code-splitting is in place** for
  `ConfigSettings`, `AuctionTicketsWorkflow`, and `AuctionItemsWorkflow`,
  wrapped in `<Suspense>` (`performance.md`, `style_guide.md`).
- **No direct `fetch()` calls in components, hooks, or context** outside
  `src/lib/google-api.ts` (`react-patterns.md`'s server/client boundary
  rule) - every network call actually goes through `fetchWithRetry`/`getBaseUrl`.
- **No derived-state duplication anti-pattern found**
  (`react-patterns.md`). No component stores a `filtered`/computed value
  in a second `useState` synced via an effect; filtering/sorting is
  computed directly in render (or via `useMemo` - see next item).
- **Memoization is applied where it actually matters, and skipped where
  it doesn't** (`performance.md`, `react-patterns.md`).
  Both the auction items table and the bidders table wrap their
  filter/sort in `useMemo` (`hooks/useAuctionItemsTableState.ts`,
  `hooks/useBiddersState.ts`) - the latter's filter also calls
  `getBidderAttendeeInfo()` per row, itself an array scan over
  `attendees`, so the O(n\*m) cost is real enough to be worth memoizing.
  Lighter, cheaper filters elsewhere in the app still run directly in
  render without one. This matches the docs' "don't memoize by default,
  do it where it's warranted" guidance rather than over- or
  under-applying it uniformly.
- **`useEffect` usage stays scoped to real external synchronization**
  (`react-patterns.md`) - 1-3 effects per file across every component
  that uses them, no effects found computing a value that could live in
  render.
- **Test assertions are not shallow placeholders where they look
  bare** (`testing-philosophy.md`). Every bare `.toHaveBeenCalled()` in
  the suite is either a `.not.toHaveBeenCalled()` negative assertion
  (which correctly needs no payload check) or `server/test/middleware.test.ts`
  confirming Express `next()` was invoked to pass a request through
  (which also has no meaningful payload to check) - not a stand-in for a
  real payload assertion that got skipped.

---

## Out of Scope, but Should be Fixed

Nothing outstanding right now.

Items belong here only when they genuinely need a decision,
documentation correction, or working environment this audit doesn't
have access to - not as a place to defer real code fixes.

---

## How to use this file

When picking up a task and you notice it touches one of the items in
"Tasks To Refactor," it's reasonable to extract the relevant piece as
part of that task - but don't turn an unrelated bug fix into a drive-by
rewrite of an unrelated file. Log new findings the same way: file,
concrete evidence (line count, grep hit, failed command), sorted into
the right one of the three sections above - not a vague "this could be
cleaner." When an item is finished, remove it from this file entirely
and record what happened in `CHANGELOG.md` instead - this file should
only ever show the current, outstanding backlog, never a history of
what's already done.
