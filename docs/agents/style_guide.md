# Visual Identity & Style Guide

This document defines the typography, color themes, spacing rules, and asset bundle optimizations of the **ORNS Charity Auction Manager**.

---

## 1. Typography & Font Selection

The app ships a single variable font family, **Geist Variable**
(`@fontsource-variable/geist`, imported in `src/index.css` and wired as
`--font-sans`/`--font-heading` in the `@theme inline` block), applied to
everything via Tailwind's `font-sans` utility on `<html>`: body text,
headings, and numeric/tabular content alike. There is no separate
monospace or display face in the app today; a previous version of this
document described a three-family Inter/Space Grotesk/JetBrains Mono
pairing that was never actually implemented (confirmed by a full search
of `src/`, `index.html`, and `package.json` on 2026-09-02, none of those
three appear anywhere). If a distinct monospace treatment for bidder IDs
or pricing metrics is wanted, that is a real design decision to make
going forward, not an existing convention to document.

---

## 2. Styling Patterns & Tailwind Guidelines

The application strictly utilizes **Tailwind CSS** utility classes directly in code. Inline style attributes are forbidden.

*   **Positive Margins & Intentional Variation**: Avoid uniform padding across all panels. Create logical division and visual rhythm by using asymmetrical padding:
    *   Large workflow sections: `p-8 md:p-10`
    *   Small dialog actions: `p-4` or `p-6`
*   **Accessibility Constraints**: Verify a high contrast ratio between foreground labels and backgrounds. Avoid low-contrast text on inputs.
*   **No Unrequested Theme Selectors**: The application runs under a default, high-contrast light theme (slate slate-colors) with clean accent borders. Do not implement complex in-app theme togglers.

---

## 3. Bundle Optimization & Lazy Loading

Vite is configured with vendor code-splitting (`vite.config.ts`'s
functional `manualChunks`), and the three heaviest workflows are lazy
loaded via dynamic imports:

*   **Config Settings Pane**: Lazy loaded as `ConfigSettings` -> `/src/components/ConfigSettings.tsx`
*   **Auction Tickets Table**: Lazy loaded as `AuctionTicketsWorkflow` -> `/src/components/AuctionTicketsWorkflow.tsx`
*   **Auction Items Listing**: Lazy loaded as `AuctionItemsWorkflow` -> `/src/components/AuctionItemsWorkflow.tsx`

Use standard React `<Suspense>` components to wrap these workflows when they are active.

**Real measured bundle size** (`npm install && npm run build`, run
2026-09-02 - updated after lazy-loading `firebase`'s init, see below):

| Chunk | Raw | Gzip |
| --- | --- | --- |
| `index` (main entry) | 108.01 kB | 29.06 kB |
| `vendor-utils` (catch-all for everything else in `node_modules`) | 263.71 kB | 85.98 kB |
| `vendor-react` | 194.40 kB | 60.73 kB |
| `vendor-recharts` | 186.67 kB | 49.55 kB |
| `vendor-base-ui` | 136.56 kB | 46.44 kB |
| `vendor-motion` | 127.89 kB | 41.94 kB |
| `vendor-lucide` | 24.12 kB | 5.25 kB |
| `index.css` | 79.70 kB | 14.10 kB |
| *Lazy, not part of initial load:* `vendor-firebase` | 691.27 kB | 160.04 kB |
| *Lazy:* `AuctionItemsWorkflow` | 43.39 kB | 11.83 kB |
| *Lazy:* `AuctionTicketsWorkflow` | 16.79 kB | 5.39 kB |
| *Lazy:* `ConfigSettings` | 14.90 kB | 4.45 kB |
| *Lazy:* `EditableCell` (auto-split - only reachable from the lazy workflow chunks above) | 3.14 kB | 1.36 kB |
| *Lazy:* `firebase-applet-config.json` | 0.58 kB | 0.36 kB |

`firebase/app`/`auth`/`firestore` are no longer part of the initial
bundle - `src/services/firebase.ts` defers `initializeApp`/`getAuth`/
`getFirestore` behind a memoized `getFirebase()` that `ConfigContext.tsx`
awaits instead of importing them statically, since cross-device config
sync isn't needed for first paint. Everything except the six lazy
chunks above loads on initial page load (`App.tsx` eagerly imports
`Dashboard`, `Bidders`, `Items`, `BidEntry`, `Checkout`, `Receipts`,
which pull in `recharts`, `motion`, and `lucide-react` immediately).
Summed, that is **~319 kB gzipped of JS** on the critical path, plus
14 kB of CSS - down from ~424 kB before this change. Per
`performance.md`'s own budget (target <200 kB, warning >300 kB,
requires review >500 kB), this is much closer to target but still
technically in the warning band; `@base-ui/react`'s heavier primitives
are the next largest eager chunk if further reduction is wanted.

One real trade-off, not hidden: `vendor-firebase` itself grew once
deferred (105.53 kB → 160.04 kB gzipped, 450.35 kB → 691.27 kB raw).
Neither `@firebase/auth` nor `@firebase/firestore` declares
`"sideEffects": false`, so Rollup loses some export-level tree-shaking
across the async `import()` boundary that it had when everything sat in
one static module graph (confirmed with a temporary
`rollup-plugin-visualizer` pass). `firebase/firestore/lite` isn't a
viable swap - it's REST-only, and this app's config sync depends on
`onSnapshot`'s real-time listener. Net effect: users who never touch
cloud sync now pay zero Firebase cost, instead of ~106 kB gzipped
unconditionally; users who do trigger it pay more than before, but only
then.
