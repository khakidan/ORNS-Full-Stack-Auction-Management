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

### Component size (`react-patterns.md`, `component-standards.md`)

| File | Lines | Note |
| --- | --- | --- |
| `src/components/Bidders.tsx` | 644 | |
| `src/components/Checkout.tsx` | 644 | |
| `src/components/ConfigSettings.tsx` | 572 | |
| `src/components/Dashboard.tsx` | 517 | |
| `src/components/TicketAttendeeTab.tsx` | 446 | |
| `src/context/AuctionContext.tsx` | 532 | Large for a context provider - worth checking whether it's holding multiple unrelated concerns that could split into separate contexts/hooks. |

All are over this codebase's own "over 400 lines: almost certainly doing
too much" guidance (`react-patterns.md`). Confirmed by `wc -l`.

### Missing shared components (`component-standards.md`)

Confirmed by grep - real, repeated duplication, not a hypothetical.

**`<DataTableWrapper>`** - A standardized scrollable grid built around
the existing `src/components/ui/table.tsx` primitives: auto-scroll via
`ScrollArea`, animated skeleton rows while `loading`, and a stylized
empty-state fallback. Would consolidate the hand-rolled table
scaffolding in `Bidders.tsx`, `Items.tsx`, `Checkout.tsx`, and
`Receipts.tsx`.

**`<StatusStatePlaceholder>`** - A generic empty/unconfigured-state
card: centered muted icon, bold heading, descriptive text, optional
action button. Consistent empty-state tone already exists ad hoc -
`"No winners found in this category."` (`Checkout.tsx`), `"No bidders
found matching \"{searchTerm}\""` (`Bidders.tsx`), `"No items found."`
(`AuctionItemsTab.tsx`), `"No receipts found in this folder."`
(`Receipts.tsx`), `"No files found in the For Print folder."`
(`DocumentCreationTab.tsx`, `TicketDocumentCreationTab.tsx`) - but each
is a separate hand-written `<p>`/`<div>`, not a shared component
(originally flagged as `Items.tsx` lines 87-91 and `Receipts.tsx` lines
63-75/100-110; re-verify line ranges before implementing).

**`<LoadingButton>`** - Wraps `Button` to natively handle busy/submitting
state: auto-disable plus a spinning `Loader2` icon. No such component
exists today; busy buttons are hand-rolled per call site with inline
`Loader2` + `animate-spin` across `BidEntry.tsx`, `Bidders.tsx`,
`Checkout.tsx`, `Receipts.tsx`.

**`<AttendeeLookupCard>`** - A contextual preview card for a parsed
Bidder or AuctionItem: name, status badges ("Checked In", "Proxy",
"Checked Out"), associated transactional data. Would consolidate the
lookup previews in `BidEntry.tsx` (originally flagged around lines
88-105) and the attendee-verification flows in `Bidders.tsx`.

**`<IconButton>`** - No dedicated wrapper; icon-only buttons use
`<Button size="icon">` directly with no type-level `aria-label`
enforcement. See the accessibility finding just below - this is not
theoretical, it has already let unlabeled icon buttons ship.

`src/components/ui/ConfirmationDialog.tsx` now exists (a shared
confirmation dialog, adopted by `AuctionItemsTab.tsx`) but other ad hoc
destructive confirmations - e.g. in `BundlingDialog.tsx` - haven't been
migrated to it yet. Worth doing opportunistically.

*Estimated impact* (from the original component-unification audit):
implementing these would cut layout boilerplate in the core workflow
components by roughly 20-30%, and would make the existing interaction
tests (table rendering, handler
assertions) more reliable without touching business logic.

### Icon-only buttons missing `aria-label` (`component-standards.md`)

`component-standards.md` requires every icon-only button to carry an
explicit `aria-label`. A repo-wide check of every real
`<Button size="icon"...>` usage in `src/components/` found **6 with no
`aria-label` at all**:

- `src/components/AuctionAssistant.tsx:149` - send-message button (only child is a `<Send>` icon)
- `src/components/DocumentCreationTab.tsx:208` - refresh-files button
- `src/components/TicketDocumentCreationTab.tsx:128` - refresh-files button
- `src/components/ui/EditableCell.tsx:102` - edit button
- `src/components/TicketAttendeeTab.tsx:59` - save-attendee button
- `src/components/TicketAttendeeTab.tsx:391` - delete-attendee button

This is a real accessibility gap, not a style nitpick - a screen reader
user gets an unlabeled button at all 6 sites today. Fixing it is a small,
mechanical change (add `aria-label="..."` to each); building the
`<IconButton>` wrapper above would prevent it from recurring.

### Hardcoded hex colors instead of the `orns-red` token (`tailwind-style-guide.md`)

This app already defines one literal brand color token,
`--color-orns-red: #e31b23` (`src/index.css`), specifically so components
don't need to hardcode that hex value. In practice it's hardcoded as an
arbitrary Tailwind value in 6 places instead of using the token class:

- `src/components/Items.tsx:35` - `text-[#e31b23]`
- `src/components/Checkout.tsx:375,391,488,514,545` - `text-[#e31b23]` / `bg-[#e31b23]` (5 occurrences)

Fix: replace each with `text-orns-red` / `bg-orns-red`.

Separately, two colors that have **no token at all** are hardcoded as
arbitrary hex values in `src/components/Dashboard.tsx`:

- `Dashboard.tsx:364,367` - `text-[#10b981]` (an emerald/green, used for a "funds raised" stat)
- `Dashboard.tsx:442,467,498` - `text-[#0c63d5]` / `bg-[#0c63d5]` (a blue, used for a "leaderboard" call-to-action)

Per `tailwind-style-guide.md`, a repeated color like this should become a
named token in `src/index.css` (the same way `orns-red` was added)
rather than staying a copy-pasted arbitrary hex value across 5 call
sites in one file.

### Manual template-literal classNames instead of `cn()` (`tailwind-style-guide.md`)

`cn()` (`src/lib/utils.ts`) exists specifically so conditional classes
don't get built with manual string interpolation. Confirmed by grep,
8 files still build `className` with a raw template literal instead:
`AuctionAssistant.tsx`, `BidEntry.tsx`, `ConfigSettings.tsx`,
`DocumentCreationTab.tsx`, `Receipts.tsx`, `Dashboard.tsx`,
`TicketAttendeeTab.tsx`, `TicketDocumentCreationTab.tsx`.
Example (`Receipts.tsx:90`):

```tsx
<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
```

should be:

```tsx
<RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
```

Low risk, high-volume cleanup - safe to do incrementally whenever one of
these files is already being touched for something else.

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
  The auction items table - the one large table that also does
  client-side sorting - wraps its filter/sort in `useMemo`
  (`hooks/useAuctionItemsTableState.ts`); the lighter `Bidders.tsx`
  filter runs directly in render without one. This matches the docs'
  "don't memoize by default, do it where it's warranted" guidance rather
  than over- or under-applying it uniformly.
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
