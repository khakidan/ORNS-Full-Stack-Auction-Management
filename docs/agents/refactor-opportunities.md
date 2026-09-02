# Refactor Opportunities

Running list of concrete, verified work items for this codebase - not
aspirational ideas, but things confirmed against the real code. Check
items off (or move them to `CHANGELOG.md`) as they're done rather than
deleting the row, so the audit trail survives.

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
| `src/components/AuctionItemsTab.tsx` | 969 | Largest component in the app by a wide margin. Almost certainly mixing table rendering, filter state, dialogs, and business logic - split before adding more to it. |
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

**`<FilterToolbar>`** - Debounced search input + optional multi-select
filter dropdowns + responsive layout with a real-time status count badge
(e.g. "Total Items: 100"). `Items.tsx`, `Checkout.tsx`, `Bidders.tsx`,
and `AuctionItemsTab.tsx` each independently render a
`<Input placeholder="Search ...">` search box with near-identical
layout (originally flagged by a prior audit as `Bidders.tsx` lines
54-66, `Items.tsx` lines 21-37, `Checkout.tsx` lines 39-44; re-verify
exact line ranges before implementing, since components shift over
time).

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
theoretical, it has already let 7 unlabeled icon buttons ship.

**`<ConfirmationDialog>`** - No shared wrapper; destructive
confirmations are built ad hoc from `alert-dialog.tsx` per call site
(e.g. `BundlingDialog.tsx`).

*Estimated impact* (from the original component-unification audit,
covering the first five of these): implementing them would cut layout
boilerplate in the core workflow components by roughly 20-30%, and
would make the existing interaction tests (table rendering, handler
assertions) more reliable without touching business logic.

### Icon-only buttons missing `aria-label` (`component-standards.md`)

`component-standards.md` requires every icon-only button to carry an
explicit `aria-label`. A repo-wide check of every real
`<Button size="icon"...>` usage in `src/components/` found **7 with no
`aria-label` at all**:

- `src/components/AuctionAssistant.tsx:149` - send-message button (only child is a `<Send>` icon)
- `src/components/DocumentCreationTab.tsx:208` - refresh-files button
- `src/components/TicketDocumentCreationTab.tsx:128` - refresh-files button
- `src/components/ui/EditableCell.tsx:102` - edit button
- `src/components/AuctionItemsTab.tsx:727` - delete-item button
- `src/components/TicketAttendeeTab.tsx:59` - save-attendee button
- `src/components/TicketAttendeeTab.tsx:391` - delete-attendee button

This is a real accessibility gap, not a style nitpick - a screen reader
user gets an unlabeled button at all 7 sites today. Fixing it is a small,
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
9 files still build `className` with a raw template literal instead:
`AuctionItemsTab.tsx`, `AuctionAssistant.tsx`, `BidEntry.tsx`,
`ConfigSettings.tsx`, `DocumentCreationTab.tsx`, `Receipts.tsx`,
`Dashboard.tsx`, `TicketAttendeeTab.tsx`, `TicketDocumentCreationTab.tsx`.
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
  `AuctionItemsTab.tsx` - the one large table that also does client-side
  sorting - wraps its filter/sort in `useMemo`; the lighter `Bidders.tsx`
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

Real, confirmed problems that aren't a code refactor - they need a
decision, a documentation correction, or a working environment this
audit didn't have.

- **`style_guide.md`'s font stack is wrong.** It lists Inter, Space
  Grotesk/Outfit, and JetBrains Mono/Fira Code. A full-repo search found
  none of these anywhere in `src/`, `index.html`, or `package.json` - the
  only font in use is **Geist Variable** (`@fontsource-variable/geist`,
  `src/index.css`'s `--font-sans`). This needs a decision, not a code
  change: either the doc gets corrected to say Geist, or the app is
  missing fonts it was supposed to ship - confirm which with whoever
  wrote the original font spec.
- **`style_guide.md`'s "under 103 kB critical path" bundle claim is
  unverified.** `npm run build` could not be run in this environment
  (missing root `node_modules` for `@tailwindcss/vite` /
  `@vitejs/plugin-react`). Needs someone with a working `npm install` to
  re-measure with a clean `npm run build` and either update the doc with
  real numbers or remove the specific figure until it can be confirmed.
- **Test count claim mismatch** (`README.md`'s "323 passing tests... 25
  focused files" vs. `AGENTS.md`'s "321 tests"). The 25-file count
  checks out by direct listing, but the two docs disagree with each
  other on the exact test-count number. Needs an actual `npm run test`
  pass (blocked by the same missing-`node_modules` environment issue
  above) to settle which is current.

---

## How to use this file

When picking up a task and you notice it touches one of the items in
"Tasks To Refactor," it's reasonable to extract the relevant piece as
part of that task - but don't turn an unrelated bug fix into a drive-by
rewrite of `AuctionItemsTab.tsx`. Log new findings the same way: file,
concrete evidence (line count, grep hit, failed command), sorted into
the right one of the three sections above - not a vague "this could be
cleaner."
