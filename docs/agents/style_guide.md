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

**Real measured bundle size** (`npm run build`, run 2026-10-23 - after
lazy-loading the Dashboard's attendance pie, see below):

| Chunk | Raw | Gzip |
| --- | --- | --- |
| `index` (main entry) | 152.02 kB | 42.02 kB |
| `vendor-utils` (catch-all for everything else in `node_modules`) | 262.75 kB | 85.03 kB |
| `vendor-react` | 194.40 kB | 60.73 kB |
| `vendor-base-ui` | 136.56 kB | 46.44 kB |
| `vendor-motion` | 127.89 kB | 41.94 kB |
| `vendor-lucide` | 31.34 kB | 6.76 kB |
| `index.css` | 84.84 kB | 15.39 kB |
| *Lazy:* `vendor-html2canvas` (bug-report screenshots) | 202.38 kB | 47.71 kB |
| *Lazy:* `vendor-recharts` (Dashboard attendance pie) | 186.67 kB | 49.55 kB |
| *Lazy:* `AuctionItemsWorkflow` | 36.64 kB | 10.13 kB |
| *Lazy:* `AuctionTicketsWorkflow` | 23.88 kB | 7.08 kB |
| *Lazy:* `ConfigSettings` | 22.08 kB | 6.44 kB |
| *Lazy:* `BugReportsAdmin` | 6.21 kB | 2.23 kB |
| *Lazy:* `FolderFilesCard` | 5.45 kB | 2.10 kB |
| *Lazy:* `AttendancePie` | 0.47 kB | 0.34 kB |

The browser no longer loads Firebase at all (since 2026-10-27, the
shared Config comes from `GET /api/config`); before that it was a lazy
~160 kB gzipped `vendor-firebase` chunk. `recharts` isn't part of the
initial bundle:
`AttendanceChart.tsx` renders its card at once and lazy-loads the pie
itself (`AttendancePie.tsx`). Everything else loads on initial page load
(`App.tsx` eagerly imports `BidManagementWorkflow.tsx`, which imports `Dashboard`, `Bidders`, `Items`, `BidEntry`,
`Checkout`, `Receipts`, which pull in `motion` and `lucide-react`
immediately). Summed, that is **~283 kB gzipped of JS** on the critical
path, plus 15 kB of CSS - down from ~333 kB before the pie was
lazy-loaded (and ~424 kB before Firebase was). Per `performance.md`'s
own budget (target <200 kB, warning >300 kB, requires review >500 kB),
this is under the warning line; `vendor-utils` and `@base-ui/react` are
the largest eager chunks if further reduction is wanted.

