# ORNS Charity Auction Manager — Core AI Agent Context

This document is the absolute single source of truth and architectural blueprint for any AI Agent or developer working on the **ORNS Charity Auction Manager** application.

The documentation has been componentized for high maintainability under `/docs/agents/`.

---

## 📂 Documentation Registry

To keep developer directives clean, maintainable, and modular, the monolithic Agent instructions have been componentized. Please refer to the corresponding subfiles below for detailed requirements and specifications:

1.  **[App Overview & High-Level Stack (README.md)](./docs/agents/README.md)**
    *   Introductory context on Oakridge Neighborhood School (ORNS) operations.
    *   Tech stack (React, Vite, Express, Sheets API, Firestore, Google Cloud Run).
    *   Bootstrap guides and environment setup parameters.

2.  **[Changelog & History (CHANGELOG.md)](./docs/agents/CHANGELOG.md)**
    *   Historical logs of feature additions, bug fixes, and critical updates.
    *   Documenting the transition of our Gemini GenAI mock tests from CIRCULAR to GOOD test cases.

3.  **[Product Roadmap & Structural Blueprint (ROADMAP.md)](./docs/agents/ROADMAP.md)**
    *   Future milestones, proposed UI component unifications, and synchronization improvements.
    *   Documentation on the componentized modular structure.

4.  **[File Reference & Topography (file-reference.md)](./docs/agents/file-reference.md)**
    *   Full stack workspace maps and comprehensive directory layouts.
    *   Index of REST routes, React views, services, and middlewares.

5.  **[Architectural Patterns & Critical Rules (patterns.md)](./docs/agents/patterns.md)**
    *   **CRITICAL DEVIATION GUARDS**: Rules on file preservation (`bidRoutes.ts`), cookie renaming (`orns_session`), and code-splitting matchers.
    *   Specific charity auction and payment surcharge integration business rules.

6.  **[Data & Integration Schemas (schema.md)](./docs/agents/schema.md)**
    *   Exact cell column index specifications for the Google Sheets primary datastore.
    *   Firestore config schemas and calculation formulas for PayPal transaction fees.

7.  **[Visual Identity & Style Guide (style_guide.md)](./docs/agents/style_guide.md)**
    *   Typography selections (Inter, Space Grotesk, JetBrains Mono) and custom spacing.
    *   Lazy-loading chunk specifications to keep critical JS path size below 103 kB.

8.  **[User Workflows & Operational Guidelines (USER_GUIDE.md)](./docs/agents/USER_GUIDE.md)**
    *   Detailed instructions for auction operations, bidding procedures, ticket sales, registration, and PayPal checkout.

9.  **[Sandbox-Safe Testing & Batches (testing-batches.md)](./docs/agents/testing-batches.md)**
    *   Step-by-step procedures to run tests in partition batches (294 backend, 188 frontend) to prevent sandboxed environment command timeouts.

10. **[Testing Philosophy & Quality Standards (testing-philosophy.md)](./docs/agents/testing-philosophy.md)**
    *   Kent C. Dodds prime directive and test quality ratings (GOOD, SHALLOW, CIRCULAR, SMOKE).
    *   Seam boundaries and lists of acceptable benign terminal warnings.

11. **[Component Standards (component-standards.md)](./docs/agents/component-standards.md)**
    *   Real inventory of `src/components/ui/` primitives, `Button`/`Select`/`Card` API conventions, and confirmed gaps (no `LoadingButton`, `IconButton`, or `ConfirmationDialog` yet).

12. **[Tailwind Style Guide (tailwind-style-guide.md)](./docs/agents/tailwind-style-guide.md)**
    *   This app's real semantic CSS-variable token system (`bg-primary`, `text-muted-foreground`, etc.) plus the one literal brand token (`orns-red`), `cn()` usage, and dark-mode infrastructure notes.

13. **[React Patterns & Architecture (react-patterns.md)](./docs/agents/react-patterns.md)**
    *   General React architecture background beneath `patterns.md`'s specific rules, plus the real (not fully layered) state of `src/lib/`/`src/context/`/`src/hooks/`.

14. **[Performance Standards (performance.md)](./docs/agents/performance.md)**
    *   Confirms this app's existing `React.lazy()` code-splitting and `vite.config.ts` vendor chunking, and flags the unverified 103 kB bundle claim in `style_guide.md`.

15. **[Refactor Opportunities (refactor-opportunities.md)](./docs/agents/refactor-opportunities.md)**
    *   Running backlog of verified refactor items: oversized components, missing shared components, and doc-vs-code mismatches to fix.

---

## 🚨 Critical Rules for AI Agents (DO NOT VIOLATE)

For the complete guidelines and background, see [`/docs/agents/patterns.md`](./docs/agents/patterns.md).

1.  **File Preservation**: **NEVER DELETE `server/routes/bidRoutes.ts`**. This managing endpoint handles critical transactional bid logs. Do not edit core SDK files (`src/services/firebase.ts`, `src/context/ConfigContext.tsx`, `firestore.rules`).
2.  **Testing Mandate**: Always run tests and verify that all **656 tests continue to pass green**. Tests must be run in two partition batches to avoid memory sandbox timeouts:
    *   **Backend (330 tests)**: `npx vitest run server/test/`
    *   **Frontend (326 tests)**: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/` (the flag is required on Node 22+ - `ConfigContext.tsx` reads `localStorage` at module load, and Node's own built-in Web Storage global can leave jsdom's `window.localStorage` undefined without it)
3.  **Session Cookie Rules**: Session cookie **MUST** remain named **`orns_session`**. Do not revert it to `__session`.
4.  **Code Splitting Rules**: The `manualChunks` function inside `vite.config.ts` must use the dynamic functional matcher structure.
5.  **PayPal Surcharges**: NEVER calculate fees client-side; always utilize `PayPalService.calculatePayPalSurcharge` server-side.
