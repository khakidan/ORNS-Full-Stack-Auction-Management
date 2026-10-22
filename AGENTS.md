# ORNS Charity Auction Manager — Core AI Agent Context

This document is the absolute single source of truth and architectural blueprint for any AI Agent or developer working on the **ORNS Charity Auction Manager** application.

The documentation has been componentized for high maintainability under `/docs/agents/`.

---

## 📂 Documentation Registry

To keep developer directives clean, maintainable, and modular, the monolithic Agent instructions have been componentized. Please refer to the corresponding subfiles below for detailed requirements and specifications:

1.  **[App Overview & High-Level Stack (README.md)](./docs/agents/README.md)**
    *   Introductory context on Orchard Ridge Nursery School (ORNS) operations.
    *   Tech stack (React, Vite, Express, Sheets API, Firestore, Google Cloud Run).
    *   Bootstrap guides and environment setup parameters.

2.  **[Changelog & History (CHANGELOG.md)](./docs/agents/CHANGELOG.md)**
    *   Historical logs of feature additions, bug fixes, and critical updates.
    *   Documenting the transition of our Gemini GenAI mock tests from CIRCULAR to GOOD test cases.

3.  **[Product Roadmap & Audit Backlog (ROADMAP.md)](./docs/agents/ROADMAP.md)**
    *   The current, verified bug/security/hardening backlog from the latest code audit (stable item IDs like `H1`, `M2`, `D4`).
    *   Net-new feature milestones.

4.  **[File Reference & Topography (file-reference.md)](./docs/agents/file-reference.md)**
    *   Full stack workspace maps and comprehensive directory layouts.
    *   Index of REST routes, React views, services, and middlewares.

5.  **[Architectural Patterns & Critical Rules (patterns.md)](./docs/agents/patterns.md)**
    *   The standing technical rules: the `orns_session` cookie name, the functional `manualChunks` matcher, and server-side-only PayPal surcharges.
    *   Specific charity auction and payment surcharge integration business rules.

6.  **[Data & Integration Schemas (schema.md)](./docs/agents/schema.md)**
    *   Exact cell column index specifications for the Google Sheets primary datastore.
    *   Firestore config schemas and calculation formulas for PayPal transaction fees.

7.  **[Visual Identity & Style Guide (style_guide.md)](./docs/agents/style_guide.md)**
    *   Typography selections (Inter, Space Grotesk, JetBrains Mono) and custom spacing.
    *   Lazy-loading chunk specifications to keep critical JS path size below 103 kB.

8.  **[User Workflows & Operational Guidelines (USER_GUIDE.md)](./docs/agents/USER_GUIDE.md)**
    *   Detailed instructions for auction operations, bidding procedures, ticket sales, registration, and PayPal checkout.

9.  **[Running the Tests (testing-batches.md)](./docs/agents/testing-batches.md)**
    *   The one command that runs the full suite, per-layer commands, and the current pass/fail totals (which live only there - not duplicated here).

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
    *   Retired on 2026-10-21 (had gone stale) - now a pointer to `ROADMAP.md`'s backlog. Older code comments citing its "Code Hardening item #N" refer to work recorded in `CHANGELOG.md`.

---

## 🚀 How This App Is Built and Shipped

Claude Code writes the code in this local repo and pushes it to GitHub (`khakidan/ORNS-Full-Stack-Auction-Management`). **Every push to `main` deploys to production** - a Cloud Build trigger builds it and deploys it to the Cloud Run service `orns-auction-manager-gh` at <https://orns-auction-manager.cloud.run> (details in [`README.md`'s Deployment section](./docs/agents/README.md#deployment)). So: work on a branch, test locally (`npm run dev` - see "Running Locally" in the same README), and merge to `main` only when the change is ready to go live.

The app was originally built in Google AI Studio. AI Studio is no longer part of development or deployment, and any file in this repo can be edited like any other.

---

## 🚨 Critical Rules for AI Agents (DO NOT VIOLATE)

For the complete guidelines and background, see [`/docs/agents/patterns.md`](./docs/agents/patterns.md).

1.  **Testing Mandate**: Always run `npm run test:quiet` (the full suite) and `npm run lint`, and confirm the totals in [`testing-batches.md`](./docs/agents/testing-batches.md), before declaring a task complete. Update those totals when they change.
2.  **Never push straight to `main`**: it deploys to production. Push a branch and let the user decide when to merge.
3.  **Session Cookie Rules**: The session cookie **MUST** remain named **`orns_session`** - renaming it signs every user out. Do not revert it to the legacy `__session`.
4.  **Code Splitting Rules**: The `manualChunks` function inside `vite.config.ts` must use the dynamic functional matcher structure.
5.  **PayPal Surcharges**: NEVER calculate fees client-side; the surcharge is computed only server-side, by `calculatePayPalSurcharge` in `server/utils/financeUtils.ts`.

---

## 🐛 In-App Bug Reports & Their Lifecycle

The floating bug icon (bottom-left corner) / Ctrl-Cmd-Shift-B shortcut lets anyone using the app capture a bug/UI/workflow-friction note without breaking flow - it auto-captures the current route, app state, browser info, recent console activity, and an optional screenshot, then saves it as a row in the dedicated **Bug-Reports spreadsheet** (`Config.bugReportsSpreadsheetId`, see `schema.md`'s "Sheet: 'Bug-Reports'" section), with screenshots uploaded to `Config.bugReportsFolderId` on Drive. If that Sheets write fails for any reason (no spreadsheet configured, an expired session), the server falls back so a report is never silently lost: in production, to one structured Cloud Logging entry (search `jsonPayload.bugReport`; the screenshot is left out, since Cloud Run's disk is in-memory and wiped on restart); in local development, to a `.md`/`.png` file pair under a gitignored `bug-reports/` directory at the repo root. The endpoint is open to unauthenticated requests on purpose; those are rate-limited per IP and can't attach a screenshot.

**These reports are a working note, not a permanent record.** Once a report's underlying fix has actually shipped and been written up in `CHANGELOG.md` (the real permanent history), close the loop:

*   Use the **Bug Reports** admin page (left sidebar, System section - `src/components/BugReportsAdmin.tsx`) to work the open queue: each row's **View** button opens a dialog with the full report and a "Copy as Markdown" button (formatted for pasting straight into a Claude Code chat, via `formatReportAsMarkdown` in `src/lib/bugReportContext.ts`) to request the fix; once fixed, **Resolve** flips that row's `Status` column to `Fixed` (`server/services/bugReportService.ts`'s `markReportResolved`) and automatically deletes its screenshot from the Bug Reports Screenshots Drive folder (`deleteScreenshotFromDrive`), so no manual spreadsheet/Drive cleanup is needed for reports that went through the Sheet.
*   If a report ever landed in the local `bug-reports/` fallback directory instead (check it occasionally - it means the Sheets write failed at submission time), delete its `.md`/`.png` files manually once handled - the admin UI only reads from the Sheet.

Do not treat an open bug-report row as itself documentation of the fix - `CHANGELOG.md` is where the real "what happened and why" write-up belongs, exactly as it does for every other fix in this codebase.
