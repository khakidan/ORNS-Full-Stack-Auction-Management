# ORNS Charity Auction Manager

The **ORNS (Oakridge Neighborhood School) Charity Auction Manager** is a high-performance, full-stack web application designed to orchestrate live and silent charity auctions. It provides a comprehensive solution for managing guest check-ins, bidder numbers, item logging, dynamic item bundling, bid tracking, and post-event checkouts. Built for high-reliability under intense auction-night traffic, the app features robust offline-first and idempotent state synchronization with Google Sheets as its primary transactional datastore, backed by Firebase for dynamic configurations.

## Tech Stack

*   **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS (using fluid responsive utilities and design system components)
*   **Animations**: Framer Motion (`motion` from `motion/react`) for fluid and purposeful route/state transitions
*   **Backend**: Express (Node.js) server running as an ES module during development and compiled to a single, high-efficiency CJS bundle for production
*   **Datastore**: Google Sheets API (for core relational databases) combined with Firebase Firestore (for distributed cloud sync of configurations)
*   **Authentication**: Firebase Authentication (Google OAuth & restricted to `@orns.org` administrative domains)
*   **Deployment**: Google Cloud Run (containerized server environment)
*   **PWA**: `vite-plugin-pwa` (installable, offline-capable web app manifest + service worker - see PWA Support below)

---

## Firebase Status

*   **Firebase Firestore & Auth**: **Retained and fully active**. These manage real-time configuration state synchronization across multi-user environments and administrative security.
*   **Firebase Hosting**: **Completely removed**. To simplify infrastructure routing, bypass CDN caching conflicts on Set-Cookie, and eliminate redundant staging environments, the application is compiled and served directly from the Google Cloud Run server instance.

---

## Architecture Overview

The codebase is split into highly modular structural patterns:

*   `/src/components/`: Extracted React components, including lazy-loaded operational interfaces (`ConfigSettings.tsx`, `AuctionTicketsWorkflow.tsx`, `AuctionItemsWorkflow.tsx`) and highly interactive sub-modules.
*   `/server/routes/`: Isolated REST endpoint pathways (`authRoutes.ts`, `bidRoutes.ts`, `bundleRoutes.ts`, `dataRoutes.ts`, `health.ts`, `productionRoutes.ts`, `receiptRoutes.ts`, `setupRoutes.ts`).
*   `/server/services/`: Global services such as `google.ts` (handling robust retry-with-backoff logic for Sheets API) and `genai.ts` (modern SDK configuration for Gemini assistant tools).
*   `/server/middleware/`: Global error interceptors, cookie session controllers, token restorer states, and cache control mechanisms.
*   `/server/utils/`: Backend computational files, Sheet API retry patterns, and cryptographic session managers.

---

## Environment Setup

The application relies on environment variables registered in a `.env` file (never `.env.local` or `.env.example` directly in execution) to boot and operate correctly:

*   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: OAuth credentials for administrative sign-in
*   `SESSION_SECRET`: Long cryptographic string for session integrity
*   `APP_URL`: Dynamic host URL (e.g., `http://localhost:3000` or production container endpoint)
*   `GEMINI_API_KEY`: Secret token for server-side AI-powered assistant functions
*   `PORT` (optional): local port to bind to, defaults to `3000` if unset. Cloud Run sets this automatically in deployed environments - only set it locally if `3000` is already taken by another app on your machine (and update `APP_URL` and the OAuth client's Authorized redirect URI, `<APP_URL>/auth/callback`, to match).

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GEMINI_API_KEY` are hard
requirements - `server/utils/validateEnv.ts` calls `process.exit(1)` on
boot if any are missing. Every other var (spreadsheet/script/template/
Drive IDs) is soft-required - the server boots without them, but the
corresponding feature is degraded until set (either in `.env` or via the
in-app Config screen once signed in).

Run `npm install`, then `npm run dev` to start the local Express/Vite dev server (port `3000` by default).

---

## PWA Support

The app is installable as a Progressive Web App via `vite-plugin-pwa`
(configured in `vite.config.ts`): a generated web manifest + service
worker (`registerType: 'autoUpdate'`, `devOptions.enabled: true` so
install/offline behavior is also testable under `npm run dev`, not just
a production build). Manifest icons live in `public/`
(`pwa-192x192.png`, `pwa-512x512.png`, `pwa-maskable-512x512.png`,
`apple-touch-icon.png`, `favicon.ico`) - currently a placeholder "O"
monogram in the app's `orns-red` brand color, not the real ORNS logo;
swap them for real artwork whenever that's available. `index.html`
carries the accompanying `theme-color`/`apple-mobile-web-app-*` meta
tags. Chrome/Edge will offer an install prompt automatically on
`localhost` (treated as a secure context) or any real HTTPS deployment;
Safari/iOS requires "Add to Home Screen" from the share sheet.

---

## Key Scripts

All core operations are managed via unified npm scripts declared in `package.json`:

*   `npm run dev`: Starts the TypeScript Express development server utilizing `tsx` on port `3000`. This exact script is also what AI Studio's own live-editing preview runs under the hood (see `vite.config.ts`'s `DISABLE_HMR` comment) - don't change its behavior here.
*   `npm run dev:watch`: Same as `npm run dev`, but backend files (`server/**`, `server.ts`) trigger an automatic restart on save via `tsx watch` (excludes `src/**`, which is already handled by Vite's own HMR). Local-only convenience - deliberately a separate script from `dev` rather than a change to it, so AI Studio's environment is unaffected.
*   `npm run build`: Bundles the React frontend into `dist/` using Vite, and compiles `server.ts` to a standalone, production-ready CommonJS file (`dist/server.cjs`) via `esbuild`.
*   `npm run start`: Runs the compiled server using standard node environments (`node dist/server.cjs`).
*   `npm run lint`: Performs static type checks using TypeScript (`tsc --noEmit`).
*   `npm run test`: Executes the complete test suite with Vitest in runner mode.
*   `npm run test:quiet`: Same as `npm run test`, but sets `NODE_OPTIONS=--no-experimental-webstorage` to suppress Node's `[DEP...]`/`ExperimentalWarning: localStorage is not available...` noise (Node's own built-in Web Storage feature, unrelated to and not used by jsdom's `window.localStorage` that the tests actually run against). Local-only convenience, deliberately a separate script rather than a change to `test` itself - that flag doesn't exist on older Node versions and would hard-error there instead of just warning, so it's not safe to assume for whatever Node version AI Studio's own environment runs. Uses inline `VAR=value` shell syntax, which needs a POSIX shell (bash/zsh/Git Bash) - not plain Windows `cmd.exe`.

---

## Test Suite

The codebase enforces a zero-regression policy backed by a robust test suite containing **728 passing tests** across 76 focused files (verified with a real `npm run test:quiet` run on 2026-09-04, matching `AGENTS.md`'s figure):
*   **Backend Integration & Units**: Managed by **Vitest**, **supertest**, and **MSW (Mock Service Worker)** to mock Google API payloads and ensure absolute safety across Sheets transactional structures.
*   **Frontend Interaction**: Managed by **React Testing Library** and **Vitest** to assert interactive transitions, sorting, searching, and conditional warning dialogs.

To run the complete suite locally:
```bash
npm run test
```

---

## Deployment

The application is deployed on **Google Cloud Run**, built and hosted
through **Google AI Studio** at a live URL
(`https://orns-auction-manager-37624994705.us-east1.run.app/`). When
building production containers:
1. The container compiles the application through `npm run build`.
2. The server boots via `npm run start` and binds to `0.0.0.0:<PORT>`
   inside the container (`PORT` defaults to `3000`; Cloud Run sets it
   automatically to match the container's configured port).
3. Ingress routing forwards standard HTTPS traffic directly to the container, with cookie sessions preserved securely via the renamed `orns_session` cookie name.

### Relationship between this local checkout and the AI Studio deployment

This local git repository is **not** wired to AI Studio's build/deploy
pipeline - there is no git remote or CI hook that pushes changes made
here to the live Cloud Run instance. The AI Studio-hosted instance is
being treated as the **staging/reference environment**: it is the
currently-live version of the app, and changes made in this local
checkout are ported back into AI Studio's own editor by hand once
verified here. Practical implications for anyone (human or agent)
working in this repo:

*   Keep changes portable - avoid anything that depends on this specific
    machine (absolute local paths, machine-specific env values baked
    into tracked files, dependencies that need a system package manager
    outside `npm`). `.env` (gitignored) is the right place for anything
    genuinely local-only, like the `PORT` override for a taken port.
*   Prefer configuration that reads from environment variables with
    sane defaults (as `PORT` and `APP_URL` already do) over hardcoded
    values, so the same code behaves correctly whether it's running
    locally, in AI Studio's own preview, or on the deployed Cloud Run
    instance.
*   Since changes are ported by hand, keep diffs reviewable - avoid
    sweeping reformatting or unrelated cleanup mixed into a real change,
    since that makes manual porting back into AI Studio's editor harder.
