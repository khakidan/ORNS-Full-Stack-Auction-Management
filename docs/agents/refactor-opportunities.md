# Refactor Opportunities

Running list of concrete, verified work items for this codebase — not
aspirational ideas, but things confirmed against the real code as of
2026-09-02. Check items off (or move them to `CHANGELOG.md`) as they're
done rather than deleting the row, so the audit trail survives.

This file absorbs [ROADMAP.md](./ROADMAP.md)'s former "Frontend UI Audit
& Component Unification Plan" section (the `<FilterToolbar>`/
`<DataTableWrapper>`/`<StatusStatePlaceholder>`/`<LoadingButton>`/
`<AttendeeLookupCard>` proposals) - that content now lives in "Missing
shared components" below, merged with this file's own independently
grep-verified findings. `ROADMAP.md` keeps only forward-looking feature
milestones, not refactor work - refactor items belong here from now on.

---

## Component size (P2 — readability & rendering)

| File | Lines | Note |
| --- | --- | --- |
| `src/components/AuctionItemsTab.tsx` | 969 | Largest component in the app by a wide margin. Almost certainly mixing table rendering, filter state, dialogs, and business logic — split before adding more to it. |
| `src/components/Bidders.tsx` | 644 | |
| `src/components/Checkout.tsx` | 644 | |
| `src/components/ConfigSettings.tsx` | 572 | |
| `src/components/Dashboard.tsx` | 517 | |
| `src/components/TicketAttendeeTab.tsx` | 446 | |
| `src/context/AuctionContext.tsx` | 532 | Large for a context provider — worth checking whether it's holding multiple unrelated concerns that could split into separate contexts/hooks. |

All are over this codebase's own "over 400 lines: almost certainly doing
too much" guidance (`react-patterns.md`). Confirmed by `wc -l`, not
estimated.

---

## Missing shared components (P2 — real duplication, confirmed by grep)

### `<FilterToolbar>`

Debounced search input + optional multi-select filter dropdowns +
responsive layout with a real-time status count badge (e.g. "Total
Items: 100"). `Items.tsx`, `Checkout.tsx`, `Bidders.tsx`, and
`AuctionItemsTab.tsx` each independently render a `<Input placeholder="Search ...">`
search box with near-identical layout - confirmed directly by grep
(originally flagged by a prior audit as `Bidders.tsx` lines 54-66,
`Items.tsx` lines 21-37, `Checkout.tsx` lines 39-44; re-verify exact line
ranges before implementing, since components shift over time). Unifying
this would make spacing, icon alignment, and mobile-stacking behavior
identical across every table-driven view.

### `<DataTableWrapper>`

A standardized scrollable grid built around the existing
`src/components/ui/table.tsx` primitives - auto-scroll via `ScrollArea`,
animated skeleton rows while `loading`, and a stylized empty-state
fallback. Would consolidate the hand-rolled table scaffolding in
`Bidders.tsx`, `Items.tsx`, `Checkout.tsx`, and `Receipts.tsx`, and
eliminate the per-file skeleton-row and empty-state boilerplate (see
"Empty-state text" below).

### `<StatusStatePlaceholder>`

A generic empty/unconfigured-state card: centered muted icon, bold
heading, descriptive text, optional action button. Consistent
empty-state tone already exists ad hoc - `"No winners found in this
category."` (`Checkout.tsx`), `"No bidders found matching
\"{searchTerm}\""` (`Bidders.tsx`), `"No items found."`
(`AuctionItemsTab.tsx`), `"No receipts found in this folder."`
(`Receipts.tsx`), `"No files found in the For Print folder."`
(`DocumentCreationTab.tsx`, `TicketDocumentCreationTab.tsx`) - but each
is a separate hand-written `<p>`/`<div>`, not a shared component
(originally flagged as `Items.tsx` lines 87-91 and `Receipts.tsx` lines
63-75/100-110; re-verify line ranges before implementing).

### `<LoadingButton>`

Wraps `Button` to natively handle busy/submitting state - auto-disable
plus a spinning `Loader2` icon. No such component exists today; busy
buttons are hand-rolled per call site with inline `Loader2` +
`animate-spin` across `BidEntry.tsx`, `Bidders.tsx`, `Checkout.tsx`,
`Receipts.tsx`. Prevents accidental double-submissions and removes
repeated spinner boilerplate.

### `<AttendeeLookupCard>`

A contextual preview card for a parsed Bidder or AuctionItem - name,
status badges ("Checked In", "Proxy", "Checked Out"), associated
transactional data. Would consolidate the lookup previews in
`BidEntry.tsx` (originally flagged around lines 88-105) and the
attendee-verification flows in `Bidders.tsx`, keeping badge colors and
detail-list layout consistent between the two.

### `<IconButton>`

No dedicated wrapper; icon-only buttons use `<Button size="icon">`
directly with no type-level `aria-label` enforcement - unlike a purpose-built
`IconButton`, nothing stops a new icon-only button from shipping without
an accessible label.

### `<ConfirmationDialog>`

No shared wrapper; destructive confirmations are built ad hoc from
`alert-dialog.tsx` per call site (e.g. `BundlingDialog.tsx`).

**Estimated impact** (from the original component-unification audit,
covering the first five of these): implementing them would cut layout
boilerplate in the core workflow components by roughly 20-30%, and since
this codebase leans on precise interaction tests (table rendering,
handler assertions - see `testing-philosophy.md`), the resulting shared
components would make those tests more reliable without touching
business logic.

---

## Architecture (P2)

- **`src/lib/` mixes pure and impure code.** `categoryHelpers.ts` and
  `utils.ts` are genuinely pure; `google-api.ts` (network calls,
  `localStorage`, retry/backoff) and `firebase.ts` (live SDK client init)
  are not. There is no `src/services/` directory, so the
  `lib → services → hooks → components` layering described in
  `react-patterns.md` doesn't fully exist on the frontend yet (it does
  exist, correctly, on the Express backend). Consider either formalizing
  a `src/services/` split or explicitly documenting `lib/` as
  "pure utilities + integration clients" rather than pretending it's all
  pure.

---

## Documentation accuracy (P1 — actively misleading right now)

- **`style_guide.md`'s font stack is wrong.** It lists Inter, Space
  Grotesk/Outfit, and JetBrains Mono/Fira Code. A full-repo search found
  none of these anywhere in `src/`, `index.html`, or `package.json` — the
  only font in use is **Geist Variable**
  (`@fontsource-variable/geist`, `src/index.css`'s `--font-sans`). Either
  the doc needs correcting to say Geist, or the app is missing fonts it
  was supposed to ship — confirm which with whoever wrote the original
  font spec before changing either side.
- **`style_guide.md`'s "under 103 kB critical path" bundle claim is
  unverified.** `npm run build` could not be run in this environment
  (missing root `node_modules` for `@tailwindcss/vite` /
  `@vitejs/plugin-react`) to confirm the number. Re-measure with a clean
  `npm install && npm run build` and update the doc with real numbers, or
  remove the specific figure until it can be confirmed.
- **Test count claim** (`README.md`'s "323 passing tests... 25 focused
  files" / `AGENTS.md`'s "321 tests") — the 25-file count checks out by
  direct listing, but the two docs disagree with each other on the exact
  test-count number (323 vs. 321). Worth a `npm run test` pass to settle
  which is current and fix whichever doc is stale.

---

## How to use this file

When picking up a task and you notice it touches one of the oversized
files or duplicated patterns above, it's reasonable to extract the
relevant piece as part of that task — but don't turn an unrelated bug fix
into a drive-by rewrite of `AuctionItemsTab.tsx`. Log new findings here
the same way: file, concrete evidence (line count, grep hit, failed
command), not a vague "this could be cleaner."
