# Refactor Opportunities

Running list of concrete, verified work items for this codebase â not
aspirational ideas, but things confirmed against the real code as of
2026-09-02. Check items off (or move them to `CHANGELOG.md`) as they're
done rather than deleting the row, so the audit trail survives.

This complements [`ROADMAP.md`](./ROADMAP.md)'s existing "Frontend UI
Audit" section (the `<FilterToolbar>`/`<DataTableWrapper>`/
`<StatusStatePlaceholder>`/`<LoadingButton>`/`<AttendeeLookupCard>`
proposals) â items below are additional findings, not a duplicate of
that list. Treat the two together as the current backlog.

---

## Component size (P2 â readability & rendering)

| File | Lines | Note |
| --- | --- | --- |
| `src/components/AuctionItemsTab.tsx` | 969 | Largest component in the app by a wide margin. Almost certainly mixing table rendering, filter state, dialogs, and business logic â split before adding more to it. |
| `src/components/Bidders.tsx` | 644 | |
| `src/components/Checkout.tsx` | 644 | |
| `src/components/ConfigSettings.tsx` | 572 | |
| `src/components/Dashboard.tsx` | 517 | |
| `src/components/TicketAttendeeTab.tsx` | 446 | |
| `src/context/AuctionContext.tsx` | 532 | Large for a context provider â worth checking whether it's holding multiple unrelated concerns that could split into separate contexts/hooks. |

All are over this codebase's own "over 400 lines: almost certainly doing
too much" guidance (`react-patterns.md`). Confirmed by `wc -l`, not
estimated.

---

## Missing shared components (P2 â real duplication, confirmed by grep)

- **`LoadingButton`** â no such component exists. Busy/spinner buttons are
  hand-rolled per call site with inline `Loader2` + `animate-spin` across
  `BidEntry.tsx`, `Bidders.tsx`, `Checkout.tsx`, `Receipts.tsx`.
- **`IconButton`** â no dedicated wrapper; icon-only buttons use
  `<Button size="icon">` directly with no type-level `aria-label`
  enforcement.
- **`ConfirmationDialog`** â no shared wrapper; destructive confirmations
  are built ad hoc from `alert-dialog.tsx` per call site (e.g.
  `BundlingDialog.tsx`).
- **Table search bar** â `Items.tsx`, `Checkout.tsx`, `Bidders.tsx`, and
  `AuctionItemsTab.tsx` each independently render a `<Input
  placeholder="Search ...">` search box with near-identical layout.
  Confirmed by direct grep, not just `ROADMAP.md`'s prior claim â worth
  re-verifying exact line ranges before implementing `ROADMAP.md`'s
  proposed `<FilterToolbar>`, since components shift over time.
- **Empty-state text** â consistent tone already exists ("No X found...")
  across `Checkout.tsx`, `Bidders.tsx`, `AuctionItemsTab.tsx`,
  `Receipts.tsx`, `DocumentCreationTab.tsx`, `TicketDocumentCreationTab.tsx`
  â but each is a separate hand-written `<p>`/`<div>`, not a shared
  component. Good candidate for `ROADMAP.md`'s proposed
  `<StatusStatePlaceholder>`.

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

## Documentation accuracy (P1 â actively misleading right now)

- **`style_guide.md`'s font stack is wrong.** It lists Inter, Space
  Grotesk/Outfit, and JetBrains Mono/Fira Code. A full-repo search found
  none of these anywhere in `src/`, `index.html`, or `package.json` â the
  only font in use is **Geist Variable**
  (`@fontsource-variable/geist`, `src/index.css`'s `--font-sans`). Either
  the doc needs correcting to say Geist, or the app is missing fonts it
  was supposed to ship â confirm which with whoever wrote the original
  font spec before changing either side.
- **`style_guide.md`'s "under 103 kB critical path" bundle claim is
  unverified.** `npm run build` could not be run in this environment
  (missing root `node_modules` for `@tailwindcss/vite` /
  `@vitejs/plugin-react`) to confirm the number. Re-measure with a clean
  `npm install && npm run build` and update the doc with real numbers, or
  remove the specific figure until it can be confirmed.
- **Test count claim** (`README.md`'s "323 passing tests... 25 focused
  files" / `AGENTS.md`'s "321 tests") â the 25-file count checks out by
  direct listing, but the two docs disagree with each other on the exact
  test-count number (323 vs. 321). Worth a `npm run test` pass to settle
  which is current and fix whichever doc is stale.

---

## How to use this file

When picking up a task and you notice it touches one of the oversized
files or duplicated patterns above, it's reasonable to extract the
relevant piece as part of that task â but don't turn an unrelated bug fix
into a drive-by rewrite of `AuctionItemsTab.tsx`. Log new findings here
the same way: file, concrete evidence (line count, grep hit, failed
command), not a vague "this could be cleaner."
