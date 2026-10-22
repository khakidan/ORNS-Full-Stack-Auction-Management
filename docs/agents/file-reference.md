# File Reference & Directory Structure

This document maps the real layout of the **ORNS Charity Auction Manager** codebase. Re-verified against the working tree on 2026-10-21 (the previous version listed several files that don't exist - `server/services/paypal.ts`, `server/middleware/auth.ts`/`cache.ts`/`session.ts`, `server/utils/sheets.ts`/`crypto.ts`, `src/lib/firebase.ts`). Test files (`*.test.ts(x)`) sit next to the code they cover in `src/`, and under `server/test/` for the backend; they're omitted below.

---

## Codebase Topography

```
├── README.md / AGENTS.md / CLAUDE.md   # Entry docs; AGENTS.md holds the rules and the branch -> main -> Cloud Run workflow
├── package.json               # Dependencies and npm scripts (see docs/agents/README.md "Key Scripts")
├── vite.config.ts             # React build, PWA plugin, functional manualChunks vendor splitting
├── vitest.config.ts           # Test runner config
├── firestore.rules            # Firestore security rules
├── firebase-applet-config.json# Firebase web client config (public identifiers, not secrets)
├── server.ts                  # Express entry point: .env load, validateEnv(), startServer(), PayPal sweeper schedule
│
├── server/                    # Express Backend Layer
│   ├── env.ts                 # Imported first by server.ts; loads .env (local development only)
│   ├── app.ts                 # Express app: JSON body limit, cookie-session (orns_session), middleware, router mounting
│   ├── boot.ts                # Vite middleware in dev; static dist/ + SPA fallback in production; listen()
│   │
│   ├── routes/
│   │   ├── authRoutes.ts      # /auth/url, /auth/callback (OAuth -> session cookie), /auth/status, /auth/logout
│   │   ├── bidRoutes.ts       # Live-auction transactions: record-winning-bid, checkout-mark-paid, close-and-cleanup, walk-in, check-in-with-bid
│   │   ├── bugReportRoutes.ts # POST /api/bug-reports (unauthenticated), /list, /resolve
│   │   ├── bundleRoutes.ts    # Gemini name/description suggestions; bundle process/restore
│   │   ├── dataRoutes.ts      # Bidder sync, PayPal sweeper status/run-now, _Settings, auction item CRUD, generic Sheets/Drive proxies, attendee field updates
│   │   ├── health.ts          # GET /api/health
│   │   ├── productionRoutes.ts# Apps Script document generators (item docs/labels/slides, bidder labels)
│   │   ├── appsScriptRoutes.ts# GET /api/apps-script/versions - live Version.gs fingerprints vs. expected
│   │   ├── receiptRoutes.ts   # Receipt generation (single/all) and receipt emails (single/all)
│   │   ├── schedulerRoutes.ts # POST /internal/paypal-sweep (Cloud Scheduler, shared-secret header)
│   │   └── setupRoutes.ts     # NDJSON-streamed new-auction setup
│   │
│   ├── middleware/
│   │   ├── cacheControl.ts    # no-store on /api/* and /auth/*
│   │   ├── errorHandler.ts    # Centralized JSON error responses (message only for signed-in staff)
│   │   ├── requireAuth.ts     # 401 unless the orns_session cookie carries tokens
│   │   └── securityHeaders.ts # No framing (CSP frame-ancestors, X-Frame-Options), nosniff, Referrer-Policy, HSTS when deployed
│   │
│   ├── services/
│   │   ├── auctionService.ts        # recordWinningBid, checkoutMarkPaid, closeAuctionAndCleanup
│   │   ├── auctionSetupService.ts   # Annual rollover / new-auction spreadsheet setup
│   │   ├── bidderService.ts         # Walk-in registration, check-in with bid, attendee field updates
│   │   ├── bugReportService.ts      # Bug-Reports sheet rows, Drive screenshots, log/local-file fallback
│   │   ├── bundleService.ts         # Gemini bundle suggestions, bundle process/restore + resequencing
│   │   ├── emailService.ts          # Receipt email HTML/MIME + Gmail send
│   │   ├── firebaseAdmin.ts         # Admin Firestore (sweeper credential/status, settings/global reads)
│   │   ├── genai.ts                 # Gemini SDK client
│   │   ├── idempotencyStore.ts      # Durable (Firestore, 24 h) idempotency records for record-winning-bid
│   │   ├── google.ts                # googleapis global retry config (no POST retries)
│   │   ├── itemDataService.ts       # Valid, sorted item list for Apps Script doc generators
│   │   ├── itemService.ts           # Auction item add/update/delete/bulk-update + resequencing
│   │   ├── oauth.ts                 # OAuth2 client (redirect URI from APP_URL only) and scopes
│   │   ├── paypalService.ts         # PayPal Invoicing API (create/send, cancel, offline payment, status)
│   │   ├── paypalSweeperJob.ts      # PayPal verification sweep (run by Cloud Scheduler / Run Now) + status
│   │   ├── receiptDataService.ts    # Won-item resolution and invoice get-or-create for receipts
│   │   ├── receiptService.ts        # Apps Script receipt calls; batch email loop
│   │   ├── sharedConfig.ts          # Server-side settings/global reads (PayPal sandbox/live)
│   │   ├── sheetsService.ts         # Staged multi-op Sheets "transaction" with rollback
│   │   └── syncService.ts           # Bidder-Numbers / Bid-Management sheet build from ticket sheets
│   │
│   ├── utils/
│   │   ├── appsScriptMode.ts  # APPS_SCRIPT_DEV_MODE -> scripts.run devMode
│   │   ├── appsScriptRun.ts   # runAppsScript (scripts.run with the real error text) + isAppsScriptFailure
│   │   ├── asyncLock.ts       # In-process per-key mutex (withLock) + runIfIdle (409 instead of a second run)
│   │   ├── bidderNumbersHeaders.ts # Bidder-Numbers A-N header row; labels L1:N1
│   │   ├── categoryHelpers.ts # Category ID bases and resequencing
│   │   ├── columnUtils.ts     # Column index -> letter
│   │   ├── financeUtils.ts    # calculatePayPalSurcharge (the only surcharge implementation)
│   │   ├── googleRetry.ts     # IDEMPOTENT_POST_RETRY opt-in for safe-to-repeat POSTs
│   │   ├── idempotency.ts     # Idempotency-key cache (in memory; `durable` adds Firestore)
│   │   ├── minRaiseHelpers.ts # Minimum-raise tiers
│   │   ├── rangeUtils.ts      # A1 range sheet-name quoting
│   │   ├── sheetCache.ts      # 5-second Sheets read cache, keyed per user
│   │   ├── validateEnv.ts     # Boot-time required env var check
│   │   └── winningBidChecks.ts # One-winner-per-item check for record-winning-bid
│   │
│   └── test/                  # Vitest + supertest + MSW backend suite (helpers/ incl. session.ts for signed test cookies, handlers.ts, setup.ts)
│
├── scripts/apps-script/            # cli.mjs (npm run gas:stamp/deploy/check) + fingerprint.mjs
├── scripts/GoogleAppsScriptsCode/   # Apps Script sources, one folder per bound spreadsheet (each with appsscript.json + .clasp.json; BidManagementSpreadsheet/not-deployed/ is reference-only, never pushed)
│   ├── BidManagementSpreadsheet/    # Receipt docs (Node supplies the data)
│   ├── ItemsSpreadsheet/            # Catalog, bid sheets, labels, slides, table tents
│   └── TicketsSpreadsheet/          # Bidder label docs
│
└── src/                       # Frontend React Layer
    ├── main.tsx               # Mount point
    ├── App.tsx                # Layout shell, workflow/tab routing, lazy-loaded views
    ├── index.css              # Tailwind + design tokens
    ├── types.ts               # Shared types (Config, GoogleTokens, bug report shapes, ...)
    ├── context/               # AuctionContext, AuthContext, ConfigContext
    ├── services/
    │   ├── firebase.ts        # Lazy Firebase app/auth/Firestore init
    │   └── google-api.ts      # fetchWithRetry (reports retries; throws ServerUnreachableError), postOnce (no retries, for Apps Script runs) + every API call to the Express server
    ├── hooks/                 # One hook per view/state concern (useCheckoutState, useGoogleAuth, ...); useOutboxReplay sends saved bids
    ├── lib/                   # Pure parsing/validation/formatting helpers, error buffer, screenshot capture;
    │                          #   bidOutbox.ts (winning bids saved on the device while offline), syncStatus.ts (retry state)
    └── components/            # Views (Dashboard, Bidders, Items, Checkout, Receipts, ConfigSettings, BidEntry, ...) and their sub-components;
                               #   SyncStatusBanner.tsx (connection banner above every page + sidebar waiting count)
        └── ui/                # Primitives: button, card, select, dialog, table, ... plus IconButton, LoadingButton, ConfirmationDialog, ListPageCard
```
