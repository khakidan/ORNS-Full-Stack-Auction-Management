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
*   `/server/middleware/`: The centralized error handler, the `requireAuth` session guard, and no-store cache headers for `/api` and `/auth`.
*   `/server/utils/`: Backend helpers - the in-process `withLock` mutex, idempotency cache, sheet read cache, range/column helpers, category and min-raise logic, the PayPal surcharge formula, and boot-time env validation.

---

## Environment Setup

The server reads its configuration from environment variables. Locally
they come from a `.env` file at the repo root (gitignored; copy
`.env.example`), which `server/env.ts` loads at boot. On Cloud Run they
are set on the service itself and there is no `.env`.

*   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: OAuth credentials for administrative sign-in
*   `SESSION_SECRET`: Long random string that signs the `orns_session` cookie
*   `APP_URL`: The URL the server is reached at (`http://localhost:<PORT>` locally, `https://orns-auction-manager.cloud.run` in production). The OAuth redirect URI is built from it as `<APP_URL>/auth/callback`
*   `GEMINI_API_KEY`: Key for the server-side Gemini bundle-suggestion features
*   `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`: PayPal Invoicing API credentials (sandbox credentials locally)
*   `PAYPAL_SWEEPER_INTERVAL_MINUTES`: Background PayPal sweep interval (default `5`); `0` turns the schedule off - see "Running Locally"
*   `PORT` (optional): Port to bind to, default `3000`. Cloud Run sets it automatically

`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
`GEMINI_API_KEY` are hard requirements - `server/utils/validateEnv.ts`
calls `process.exit(1)` on boot if any are missing (and `server/app.ts`
independently throws on a missing `SESSION_SECRET`, so cookies are never
signed with a fallback key). Every other var (spreadsheet/script/template/
Drive IDs) is soft-required - the server boots without them, but the
corresponding feature is degraded until set (either in `.env` or via the
in-app Config screen once signed in).

---

## Running Locally

One-time setup:

1.  **Node.js 22** (the version Cloud Run's buildpack uses), then `npm install`.
2.  `cp .env.example .env` and fill it in. Use the same `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` as production (one OAuth client serves both), any long random `SESSION_SECRET`, and **PayPal sandbox** credentials. Set `APP_URL=http://localhost:<PORT>` with the `PORT` you'll use.
3.  In Google Cloud Console (project `orns-auction-bid-management`) -> Google Auth Platform -> Clients -> the app's OAuth client, add `http://localhost:<PORT>/auth/callback` to **Authorized redirect URIs**. Firebase Auth (the Cloud Sync sign-in) already allows `localhost` by default.
4.  Optional - only needed for the PayPal sweeper and its status card: run `gcloud auth application-default login` with an account that can access the `orns-auction-bid-management` Firebase project, so `firebase-admin` can reach Firestore. Without it, login and normal use still work; the sweeper just logs that it can't reach Firestore.

Then `npm run dev` (or `npm run dev:watch` to auto-restart on backend edits) and open `http://localhost:<PORT>`.

**A local server works on live data.** It reads the same shared Config from Firestore (`settings/global`) as production, so it opens the same spreadsheets, and the in-app PayPal sandbox/live toggle is shared too. Keep `PAYPAL_SWEEPER_INTERVAL_MINUTES=0` in `.env` (the `.env.example` default) so your machine doesn't run a second PayPal sweeper against the live Bidder-Numbers sheet. To test against throwaway data, point the Config screen at copies of the spreadsheets - and remember that changes it there for production too.

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

All core operations are managed via npm scripts declared in `package.json`:

*   `npm run dev`: Starts the Express server with Vite in middleware mode (HMR for `src/**`) via `tsx`, on `PORT` (default `3000`).
*   `npm run dev:watch`: Same as `npm run dev`, but backend files (`server/**`, `server.ts`) also trigger an automatic restart on save via `tsx watch`.
*   `npm run build`: Bundles the React frontend into `dist/` using Vite, and compiles `server.ts` to a standalone CommonJS file (`dist/server.cjs`) via `esbuild`. Cloud Run's buildpack runs this.
*   `npm run start`: Runs the compiled server (`node dist/server.cjs`). This is the production entry point on Cloud Run; locally, run it after `npm run build` with `NODE_ENV=production` to try the production build.
*   `npm run lint`: Static type checks (`tsc --noEmit`).
*   `npm run test`: Runs the complete test suite with Vitest.
*   `npm run test:quiet`: Same as `npm run test`, with `NODE_OPTIONS=--no-experimental-webstorage` - required on Node 22+, where Node's own built-in Web Storage global can leave jsdom's `window.localStorage` undefined (`ConfigContext.tsx` reads it at module load). Uses inline `VAR=value` shell syntax, which needs a POSIX shell (bash/zsh/Git Bash).

---

## Test Suite

The codebase enforces a zero-regression policy. Current pass/fail totals live only in [`testing-batches.md`](./testing-batches.md), not duplicated here:
*   **Backend Integration & Units**: **Vitest**, **supertest**, and **MSW (Mock Service Worker)** to mock Google/PayPal API payloads. Route tests sign in with a real signed `orns_session` cookie (`server/test/helpers/session.ts`), the same way a browser does.
*   **Frontend Interaction**: **React Testing Library** and **Vitest**.

To run the complete suite:
```bash
npm run test:quiet
```

---

## Deployment

**Pushing to `main` deploys to production.** The GitHub repo
(`khakidan/ORNS-Full-Stack-Auction-Management`) is connected to Cloud
Run through Developer Connect: every push to `main` fires a Cloud Build
trigger that builds the repo with Google Cloud's Node.js 22 buildpack (no
Dockerfile - it runs `npm run build`, then starts the container with
`npm start`) and deploys it to the Cloud Run service
**`orns-auction-manager-gh`** in **us-east1**, served at
**https://orns-auction-manager.cloud.run**. (The Cloud Build trigger
itself lives in `europe-west1` - a quirk of how it was created - but it
deploys to us-east1.)

Workflow:

1.  Do work on a branch, never directly on `main`.
2.  Run the tests (`npm run test:quiet`, `npm run lint`) and try the change locally (`npm run dev`).
3.  Merge to `main` (via a GitHub pull request) only when it's ready to go live - the merge is the deploy, live within a few minutes.

Production configuration (all the environment variables above, with
production values) is set on the `orns-auction-manager-gh` service in
the Cloud Run console, not in any file in this repo. The server binds
`0.0.0.0:$PORT`; Cloud Run terminates HTTPS in front of it, and
`app.set("trust proxy", 1)` is what lets Express treat those requests as
secure for the `orns_session` cookie.

When the production URL changes (a new service or custom domain), two
allowlists must be updated or sign-in breaks: the OAuth client's
**Authorized redirect URIs** (`<URL>/auth/callback`) in Google Cloud
Console, and **Firebase console -> Authentication -> Settings ->
Authorized domains** (bare domain) for the Cloud Sync sign-in.

The app was originally built in Google AI Studio, which ran it inside an
iframe and deployed it to a separate Cloud Run service
(`orns-auction-manager`, domain `orns-auction-manager.ai.studio`). That
service, if it still exists, is a retired fallback that no longer
receives updates; AI Studio is no longer part of development or
deployment.
