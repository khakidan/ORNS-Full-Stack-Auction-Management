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
2026-09-02 - this replaces a previous, unverified "under 103 kB critical
path" claim that did not match a real build):

| Chunk | Raw | Gzip |
| --- | --- | --- |
| `index` (main entry) | 102.91 kB | 26.32 kB |
| `vendor-react` | 194.40 kB | 60.73 kB |
| `vendor-recharts` | 186.62 kB | 49.53 kB |
| `vendor-motion` | 127.89 kB | 41.94 kB |
| `vendor-lucide` | 24.13 kB | 5.25 kB |
| `vendor-utils` (catch-all for everything else in `node_modules`) | 851.07 kB | 237.78 kB |
| `index.css` | 80.73 kB | 14.08 kB |
| *Lazy, not part of initial load:* `ConfigSettings` | 13.59 kB | 4.09 kB |
| *Lazy:* `AuctionTicketsWorkflow` | 17.43 kB | 5.38 kB |
| *Lazy:* `AuctionItemsWorkflow` | 43.66 kB | 11.75 kB |

Everything except the three lazy workflow chunks loads on initial page
load (`App.tsx` eagerly imports `Dashboard`, `Bidders`, `Items`,
`BidEntry`, `Checkout`, `Receipts`, which pull in `recharts`, `motion`,
and `lucide-react` immediately). Summed, that is **~421 kB gzipped of
JS** on the critical path, plus 14 kB of CSS - not under 103 kB. Per
`performance.md`'s own budget (target <200 kB, warning >300 kB, requires
review >500 kB), this sits in the warning band, driven almost entirely
by the 238 kB `vendor-utils` catch-all chunk. Splitting `vendor-utils`
further (e.g. giving `firebase` and `@base-ui/react` - both real,
substantial dependencies swept into that one bucket today - their own
named chunks in `vite.config.ts`'s `manualChunks`) is a reasonable next
optimization, but is a separate, deliberate performance pass, not a
one-line doc fix.
