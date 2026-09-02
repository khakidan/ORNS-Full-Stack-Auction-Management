# Project Roadmap & Structural Blueprint

This document outlines the high-level roadmap, future milestones, and architectural evolution of the **ORNS Charity Auction Manager**.

---

## 1. Frontend UI Audit & Component Unification Plan

I have performed a comprehensive, read-only audit of the ORNS Charity Auction Manager frontend user interface files. The audit focuses on identifying repetitive patterns, structural inconsistencies, and areas where unified, highly reusable UI components would streamline the codebase and elevate the visual cohesion of the application.

Below is the list of proposed unified components, including their functional definitions, structural designs, and aesthetic benefits.

### 1. `<FilterToolbar>` (Unified Search & Filter Control Bar)
- **What it does**: This component encapsulates a debounced search input, optional multi-select dropdown filters, and a responsive layout with a real-time status count badge (e.g., "Total Items: 100").
- **Where it unifies code**: Replaces custom search/filter bars in `Bidders.tsx` (lines 54-66), `Items.tsx` (lines 21-37), and `Checkout.tsx` (lines 39-44).
- **Aesthetic & Codebase Benefit**: Ensures that spacing, padding, search icon alignment, and responsive wrapping behavior (stacking on mobile, side-by-side on desktop) are perfectly identical across all table-driven views, reducing duplicate Search, Filter, and layout structures.

### 2. `<DataTableWrapper>` (Standardized Scrollable Grid)
- **What it does**: A high-performance, responsive table container built around the existing `@/components/ui/table` primitives. It handles automatic scrolling via `<ScrollArea>`, displays animated skeleton layouts when `loading` is true, and presents a stylized fallback view when data is empty.
- **Where it unifies code**: Consolidates tabular displays in `Bidders.tsx`, `Items.tsx`, `Checkout.tsx`, and `Receipts.tsx`.
- **Aesthetic & Codebase Benefit**: Eliminates manually written skeleton rows, custom conditional logic for empty states, and inconsistent table-cell padding. It enforces standard, predictable column text-wrapping and responsive layout density.

### 3. `<StatusStatePlaceholder>` (Config & Empty State Card)
- **What it does**: A generic visual placeholder card displaying a centered, muted Lucide icon, a bold structural heading, a detailed descriptive text, and optional action buttons.
- **Where it unifies code**: Unifies empty results in `Items.tsx` (lines 87-91), empty lists in `Receipts.tsx` (lines 100-110), and the unconfigured folder view in `Receipts.tsx` (lines 63-75).
- **Aesthetic & Codebase Benefit**: Guarantees a consistent structural margin, elegant color contrast, and central text centering across all "no data" and "missing configuration" screens.

### 4. `<LoadingButton>` (Extended Action Button)
- **What it does**: A wrapper around the standard `<Button>` component that handles busy/submitting states natively by auto-disabling interaction and injecting a spinning `<Loader2 className="animate-spin" />` icon alongside custom label transitions.
- **Where it unifies code**: Used in forms and actions across `BidEntry.tsx`, `Bidders.tsx`, `Checkout.tsx`, and `Receipts.tsx` where background synchronization and database calls occur.
- **Aesthetic & Codebase Benefit**: Prevents accidental double-submissions, reduces boilerplates of manual inline spinner logic, and standardizes action button micro-interactions.

### 5. `<AttendeeLookupCard>` (Bidder & Item Detail Lookups)
- **What it does**: A contextual preview card that accepts a parsed Bidder or AuctionItem object and renders their name, status badges (e.g., "Checked In", "Proxy", "Checked Out"), and associated transactional data with strict visual contrast.
- **Where it unifies code**: Consolidates the lookup previews in `BidEntry.tsx` (lines 88-105) and attendee verification flows in `Bidders.tsx`.
- **Aesthetic & Codebase Benefit**: Unifies how attendee and winner detail lists look in administrative panels, preventing color variation discrepancies and ensuring badges remain highly readable.

### Audit Summary
Implementing these five clean abstractions would reduce the volume of layout boilerplate in the core workflow components by approximately 20% to 30%. Because the codebase relies on precise unit tests (such as assertions of table rendering and interaction handlers), these abstractions would make test suites far more reliable and easier to maintain without changing core functional business logic.

---

## 2. Near-Term Milestones (Staging)

### Milestone A: Sync & Retry Resiliency
- Implement visual indicator banners within the frontend configuration header when Google Sheets syncing transactions are retrying in the background.
- Introduce client-side offline queues that buffer bid logs temporarily in local storage during brief network drops, then replay them with idempotency keys upon restoration.

### Milestone B: Advanced Reporting Dashboards
- Expand the analytics engine within `/src/components/Dashboard.tsx` to visualize bid distributions over time, total funds raised by category, and real-time checkout percentages via D3 charts.
