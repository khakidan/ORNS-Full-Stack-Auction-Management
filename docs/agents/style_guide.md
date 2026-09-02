# Visual Identity & Style Guide

This document defines the typography, color themes, spacing rules, and asset bundle optimizations of the **ORNS Charity Auction Manager**.

---

## 1. Typography & Font Selection

Our typography pairings convey a clean, functional, yet professional and high-reliability atmosphere appropriate for fast-paced, high-pressure live-event administration:

*   **Primary Body Text**: **Inter** (sans-serif) for extreme legibility, clean layout density, and form fields.
*   **Headings / Display Elements**: **Space Grotesk** or **Outfit** to establish a tech-forward, high-contrast, structured feel.
*   **Logs / Monospace Accents**: **JetBrains Mono** or **Fira Code** for displaying bidder IDs, pricing metrics, transaction references, and tabular numeric values.

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

To maintain a critical path bundle size of under **103 kB**, Vite is configured to implement aggressive vendor code-splitting. Heavy workflows must be lazy loaded via dynamic imports:

*   **Config Settings Pane**: Lazy loaded as `ConfigSettings` -> `/src/components/ConfigSettings.tsx`
*   **Auction Tickets Table**: Lazy loaded as `AuctionTicketsWorkflow` -> `/src/components/AuctionTicketsWorkflow.tsx`
*   **Auction Items Listing**: Lazy loaded as `AuctionItemsWorkflow` -> `/src/components/AuctionItemsWorkflow.tsx`

Use standard React `<Suspense>` components to wrap these workflows when they are active.
