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
2026-09-02 - updated after splitting `firebase`/`@base-ui/react` out of
`vendor-utils`, see below):

| Chunk | Raw | Gzip |
| --- | --- | --- |
| `index` (main entry) | 107.67 kB | 29.06 kB |
| `vendor-firebase` | 450.35 kB | 105.53 kB |
| `vendor-utils` (catch-all for everything else in `node_modules`) | 263.71 kB | 85.98 kB |
| `vendor-react` | 194.40 kB | 60.73 kB |
| `vendor-recharts` | 186.67 kB | 49.55 kB |
| `vendor-base-ui` | 136.57 kB | 46.44 kB |
| `vendor-motion` | 127.89 kB | 41.94 kB |
| `vendor-lucide` | 24.13 kB | 5.25 kB |
| `index.css` | 79.70 kB | 14.10 kB |
| *Lazy, not part of initial load:* `ConfigSettings` | 14.99 kB | 4.47 kB |
| *Lazy:* `AuctionTicketsWorkflow` | 17.89 kB | 5.75 kB |
| *Lazy:* `AuctionItemsWorkflow` | 45.86 kB | 12.40 kB |

Everything except the three lazy workflow chunks loads on initial page
load (`App.tsx` eagerly imports `Dashboard`, `Bidders`, `Items`,
`BidEntry`, `Checkout`, `Receipts`, which pull in `recharts`, `motion`,
and `lucide-react` immediately, and `useConfig`/`ConfigContext` pull in
`firebase` for cross-device config sync). Summed, that is **~424 kB
gzipped of JS** on the critical path, plus 14 kB of CSS - essentially
unchanged from the previous ~421 kB total, as expected: splitting
`vendor-utils` into named chunks doesn't reduce bytes shipped on first
load by itself (nothing here is lazy-loaded), it only makes bundle
growth attributable per-dependency and lets the browser cache
`vendor-firebase`/`vendor-base-ui` independently of app-code changes
between deploys. Per `performance.md`'s own budget (target <200 kB,
warning >300 kB, requires review >500 kB), the critical path still sits
in the warning band - reducing the actual byte count would require
lazy-loading `firebase` (e.g. behind the cloud-sync UI in
`ConfigSettings.tsx`, since most of the app doesn't need Firestore/Auth
on first paint) or `@base-ui/react`'s heavier primitives, which is a
separate, deliberate performance pass, not a chunking change.
