# Changelog

All notable changes to the **ORNS Charity Auction Manager** will be documented in this file.

## [Unreleased]

### Added

- Created a modular documentation system in `/docs/agents/` to break down the monolithic `AGENTS.md` and `README.md` files into organized subfiles.
- Added `/docs/agents/CHANGELOG.md` to track feature updates, bug fixes, and system improvements.
- Added `/docs/agents/ROADMAP.md` outlining future developments and system-wide structural proposals.
- Added `/docs/agents/file-reference.md` for full project topography and directory listings.
- Added `/docs/agents/patterns.md` detailing architectural guidelines, transactional patterns, and critical developer rules.
- Added `/docs/agents/schema.md` for sheets data integration schemas and column structures.
- Added `/docs/agents/style_guide.md` specifying design philosophy, bundle optimizations, and tailwind typography.
- Added `/docs/agents/testing-batches.md` explaining Sandbox-safe Vitest partitioning.
- Added `/docs/agents/testing-philosophy.md` enforcing rigorous quality rating criteria (GOOD, SHALLOW, CIRCULAR, SMOKE) and mock limits.
- Added `docs/agents/component-standards.md`, `tailwind-style-guide.md`, `react-patterns.md`, `performance.md`, and `refactor-opportunities.md` - app-specific standards docs verified directly against this codebase (the previously-uploaded generic versions of these described a different, unrelated app).
- Added `src/components/ui/ConfirmationDialog.tsx`, a shared confirmation dialog (`open`/`onOpenChange`/`title`/`description`/`confirmLabel`/`cancelLabel`/`onConfirm`/`isLoading`/`variant`/`icon` props), first adopted by `AuctionItemsTab.tsx`'s two confirmation dialogs.
- Added PWA support via `vite-plugin-pwa`: web manifest, service worker (`registerType: 'autoUpdate'`, `devOptions.enabled: true`), and a placeholder icon set in `public/`.
- Added local dev support for a configurable `PORT` env var (`server.ts`, `.env.example`) so the app can run on a port other than 3000 when that's already taken.
- Added `npm run dev:watch`, a local-only script (`tsx watch`, excluding `src/**`) that auto-restarts the backend on `server/**` changes. Deliberately a *separate* script from `dev` - `dev` itself is what AI Studio's own live-editing preview runs under the hood (`vite.config.ts`'s `DISABLE_HMR` comment), and an earlier version of this change mistakenly edited `dev` directly, which would have added an ungated restart-on-change watcher to AI Studio's own edit loop and reintroduced the exact flickering/instability `DISABLE_HMR` exists to prevent. Caught before being ported back; `dev` is untouched.

### Changed

- Moved `README.md` to `/docs/agents/README.md` to consolidate the overall system architecture guidance.
- Moved `USER_GUIDE.md` to `/docs/agents/USER_GUIDE.md` and updated structural references to point staff and operators directly to the new directory.
- Merged all modular directory lists and metadata links from the redundant `/docs/agents/AGENTS.md` file back into the primary root `/AGENTS.md` index file, and safely deleted `/docs/agents/AGENTS.md` to eliminate configuration duplication.
- Strengthened mock-assertion validation for Gemini genAI endpoints inside `/server/test/bundle.test.ts`. Converted three CIRCULAR test cases ("AI name suggestions — happy path", "AI description suggestion — happy path", and "Happy path — returns AI response text") into GOOD test cases asserting deep prompt checks.
- Cleaned up obsolete tests in `/server/test/items.test.ts` to maintain high-quality testing standards (removed UI-only canceled action checking and empty single-item selection checks).
- Updated documentation across `AGENTS.md` to accurately reflect a test count of 321 passing tests (233 backend, 88 frontend).
- Split `src/components/AuctionItemsTab.tsx` (969 lines) into `AuctionItemsFilterBar.tsx`, `AuctionItemsTable.tsx`, `AuctionItemRow.tsx`, `AuctionItemsBulkActionBar.tsx`, `AddAuctionItemDialog.tsx`, `hooks/useAuctionItemsTableState.ts`, and `lib/auctionItemPricing.ts` (177 lines remaining in the container). All 10 existing `AuctionItemsTab.test.tsx` tests pass unmodified; full suite 321/321, `npm run build` clean.
- Upgraded `@tailwindcss/vite`/`tailwindcss` (4.1.14 → 4.3.3) and `tsx` (4.21.0 → 4.23.13) to resolve a Node `module.register()` deprecation warning on `npm run dev` boot (fixed upstream in `@tailwindcss/node`, which now uses `module.registerHooks()` when available).
- Moved ROADMAP.md's former "Frontend UI Audit & Component Unification Plan" section into `refactor-opportunities.md`; `ROADMAP.md` now holds only forward-looking feature milestones.
- Corrected `style_guide.md`'s font stack (claimed Inter/Space Grotesk/JetBrains Mono; the app only ever shipped Geist Variable) and its bundle-size claim (unverified "under 103 kB critical path" replaced with real measured numbers, ~421 kB gzipped, from a working `npm install && npm run build`).
- Corrected `README.md`'s test count (323 → verified 321, matching `AGENTS.md`).
- Corrected `schema.md`'s Firestore "Shared Config Schema" section, which described fields (`activeSpreadsheetId`, `syncStatus`, `paypalSurchargePercentage`, etc.) that don't exist anywhere in the real `Config` type consumed by `src/context/ConfigContext.tsx`.

### Fixed

- Missing `aria-label` on `AuctionItemsTab.tsx`'s icon-only delete button (now `AuctionItemRow.tsx`).
- Manual template-literal `className` for row-selection styling in `AuctionItemsTab.tsx` replaced with `cn()` (now `AuctionItemRow.tsx`).
- A `colSpan={6}` on `AuctionItemsTab.tsx`'s 8-column table's empty-state row, corrected to `colSpan={8}` (now `AuctionItemsTable.tsx`).
- Removed dead `Bidder`/`Attendee`/`Guest` imports and a no-op empty `useEffect` from `AuctionItemsTab.tsx`.

### Removed

- Obsolete pre-refactor docs describing a monolithic `server.ts` that no longer exists in this codebase: `BACKEND_DOCUMENTATION.md`, `CODE_AUDIT.md`, `ORPHANED_CODE_ANALYSIS.md`, `REFACTORING_ROADMAP.md`.
- Duplicate root-level `USER_GUIDE.md` (kept `docs/agents/USER_GUIDE.md`, the canonical location per `AGENTS.md`'s registry).
- Unused `firebase-blueprint.json` (its schema was accurate and was folded into `schema.md` first; `firestore.rules` and `firebase-applet-config.json` were kept since both are actually live-referenced).
