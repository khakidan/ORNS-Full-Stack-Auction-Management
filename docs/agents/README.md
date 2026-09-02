# ORNS Charity Auction Manager

The **ORNS (Oakridge Neighborhood School) Charity Auction Manager** is a high-performance, full-stack web application designed to orchestrate live and silent charity auctions. It provides a comprehensive solution for managing guest check-ins, bidder numbers, item logging, dynamic item bundling, bid tracking, and post-event checkouts. Built for high-reliability under intense auction-night traffic, the app features robust offline-first and idempotent state synchronization with Google Sheets as its primary transactional datastore, backed by Firebase for dynamic configurations.

## Tech Stack

*   **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS (using fluid responsive utilities and design system components)
*   **Animations**: Framer Motion (`motion` from `motion/react`) for fluid and purposeful route/state transitions
*   **Backend**: Express (Node.js) server running as an ES module during development and compiled to a single, high-efficiency CJS bundle for production
*   **Datastore**: Google Sheets API (for core relational databases) combined with Firebase Firestore (for distributed cloud sync of configurations)
*   **Authentication**: Firebase Authentication (Google OAuth & restricted to `@orns.org` administrative domains)
*   **Deployment**: Google Cloud Run (containerized server environment)

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

Run `npm install`, then `npm run dev` to start the local Express/Vite dev server on port `3000`.

---

## Key Scripts

All core operations are managed via unified npm scripts declared in `package.json`:

*   `npm run dev`: Starts the TypeScript Express development server utilizing `tsx` on port `3000`.
*   `npm run build`: Bundles the React frontend into `dist/` using Vite, and compiles `server.ts` to a standalone, production-ready CommonJS file (`dist/server.cjs`) via `esbuild`.
*   `npm run start`: Runs the compiled server using standard node environments (`node dist/server.cjs`).
*   `npm run lint`: Performs static type checks using TypeScript (`tsc --noEmit`).
*   `npm run test`: Executes the complete test suite with Vitest in runner mode.

---

## Test Suite

The codebase enforces a zero-regression policy backed by a robust test suite containing **321 passing tests** across 25 focused files (verified with a real `npm run test` run on 2026-09-02, matching `AGENTS.md`'s figure):
*   **Backend Integration & Units**: Managed by **Vitest**, **supertest**, and **MSW (Mock Service Worker)** to mock Google API payloads and ensure absolute safety across Sheets transactional structures.
*   **Frontend Interaction**: Managed by **React Testing Library** and **Vitest** to assert interactive transitions, sorting, searching, and conditional warning dialogs.

To run the complete suite locally:
```bash
npm run test
```

---

## Deployment

The application is deployed on **Google Cloud Run**. When building production containers:
1. The container compiles the application through `npm run build`.
2. The server boots via `npm run start` and binds to `0.0.0.0:3000` inside the container.
3. Ingress routing forwards standard HTTPS traffic directly to the container, with cookie sessions preserved securely via the renamed `orns_session` cookie name.
