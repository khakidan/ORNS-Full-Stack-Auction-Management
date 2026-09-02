# Performance Standards

> **Status: written for this codebase's actual current state**, verified
> against `vite.config.ts`, `package.json`, and `src/App.tsx` on
> 2026-09-02. [`style_guide.md`](./style_guide.md) currently states a
> "critical path bundle size under 103 kB" target - **that number could
> not be verified**: `npm run build` fails in this environment because
> `node_modules` isn't installed at the project root (Vite's config
> imports `@tailwindcss/vite` / `@vitejs/plugin-react`, both resolved
> from a different `node_modules` on this machine). Don't repeat the
> 103 kB figure as a confirmed fact until someone runs `npm install &&
> npm run build` in a properly set-up environment and reads Vite's real
> per-chunk `gzip:` output - same principle as this doc's own rule below:
> measure, don't guess.

This project follows: **Measure first. Optimize second.**

---

# Performance Priorities

1. User-perceived responsiveness
2. Initial page load
3. Interaction latency
4. Rendering efficiency
5. Bundle size
6. Background processing

This ordering matters more than usual here: this app is used live,
during in-person auction events, by staff doing rapid bid entry and
checkout on `BidEntry.tsx`/`Checkout.tsx` under time pressure -
interaction latency on those two screens has more real-world impact than
initial bundle size once the app is loaded and running for the evening.

---

# What this app already does for code splitting

`src/App.tsx` already lazy-loads three route-level workflows via
`React.lazy()`, exactly matching the pattern this doc recommends:

```tsx
const ConfigSettings = lazy(() => import("./components/ConfigSettings"));
const AuctionTicketsWorkflow = lazy(() => import("./components/AuctionTicketsWorkflow"));
const AuctionItemsWorkflow = lazy(() => import("./components/AuctionItemsWorkflow"));
```

wrapped in `<Suspense>` per `style_guide.md`. `Dashboard`, `Bidders`,
`Items`, `BidEntry`, `Checkout`, `Receipts` are imported eagerly at the
top of `App.tsx` - these are the always-visible core workflow tabs, so
eager-loading them is a reasonable choice, not an oversight.

`vite.config.ts` already defines manual vendor chunks by dependency:
`vendor-react`, `vendor-recharts`, `vendor-motion` (`motion`/`framer-motion`),
`vendor-lucide`, and a catch-all `vendor-utils` for everything else in
`node_modules`. Per `patterns.md`'s non-negotiable rule, this must stay a
**functional matcher** (`manualChunks(id) { ... }`), not a static
object-mapping form - reverting that breaks vendor splitting.

---

# Bundle Management

## Measure Bundle Size

Run `npm install && npm run build` and read Vite's own per-chunk `gzip:`
output. Do not trust a stale number in a doc (including this one, until
someone re-measures). For a deeper look at what's inside a large chunk,
install `rollup-plugin-visualizer` temporarily, generate the treemap,
then uninstall it - don't leave it as a permanent dependency.

## Real dependencies with real weight

Worth watching in any future measurement pass, since they're the
heaviest real dependencies in `package.json`: `recharts` (already its
own `vendor-recharts` chunk - used by `Dashboard.tsx`'s charts),
`motion` (already its own `vendor-motion` chunk), `react-markdown`
(used where markdown rendering is needed - confirm it's not pulled into
an eagerly-loaded chunk), `firebase` (Firestore + Auth client SDK,
loaded via `src/lib/firebase.ts`), and `googleapis`/`google-auth-library`
(these should only ever be backend/`server/` dependencies - verify
neither leaks into a frontend chunk).

---

# React Rendering Performance

## Memoization

Do not memoize by default. This app's real usage is already sparse (see
`react-patterns.md`) - keep it that way. Use `useMemo`/`useCallback` only
where profiling or an obvious O(n) recompute on every keystroke (e.g. a
search-filtered table over hundreds of rows in `Bidders.tsx` or
`AuctionItemsTab.tsx`) justifies it.

## Component Boundaries

The oversized top-level views (`AuctionItemsTab.tsx`, `Bidders.tsx`,
`Checkout.tsx`, `ConfigSettings.tsx`, `Dashboard.tsx`) are also a
rendering-performance concern, not just a maintainability one: a single
969-line component re-renders as one unit on any state change inside it.
Splitting them (tracked in `refactor-opportunities.md`) has a real
rendering-performance benefit alongside the readability one.

---

# Google Sheets / API Considerations

This app uses Google Sheets as its actual transactional backend
(`server/services/google.ts`, resilient wrapper with retry/backoff) and
Firestore for shared config state. Be careful with repeated reads,
duplicate writes, unnecessary refreshes - this is the single most
sensitive performance area in this app given it's rate-limited external
API, and per `patterns.md` it's also tied to real business rules (bid
transaction integrity, re-sequencing on status changes). Read
`patterns.md`'s Data Synchronization Flow section before touching any
mutation path.

---

# Animation Performance

This app uses `motion` (`from "motion/react"`, the successor to
Framer Motion) for route/state transitions, per `README.md`. Prefer
`transform`/`opacity`-based animations; avoid animating layout properties
(`width`, `height`, `position`).

---

# Performance Review Checklist

Before merging:
- Did bundle size increase significantly? (measure with a real
  `npm run build`, not the stale 103 kB figure)
- Was a new dependency added, and does it belong in `vite.config.ts`'s
  manual chunk map?
- Is lazy loading appropriate for the new surface, matching the existing
  `ConfigSettings`/`AuctionTicketsWorkflow`/`AuctionItemsWorkflow`
  pattern?
- Are unnecessary renders introduced into one of the already-oversized
  view components?
- Is `BidEntry.tsx`/`Checkout.tsx` interaction latency still fast under
  live-event conditions?

---

# AI Generation Rules

Prefer simple components, lazy loading for large new workflow surfaces
(matching the existing three), measured optimization over guessed
optimization. Avoid premature memoization, avoid adding a dependency that
duplicates something `recharts`/`motion`/`date-fns`/`lucide-react`
already covers, avoid loading everything eagerly. When in doubt about
bundle impact, say so explicitly rather than asserting a number that
hasn't been measured in this environment.
