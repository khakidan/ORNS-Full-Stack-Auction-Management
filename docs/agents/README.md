# ORNS Charity Auction Manager

The **ORNS (Orchard Ridge Nursery School) Charity Auction Manager** is a high-performance, full-stack web application designed to orchestrate live and silent charity auctions. It provides a comprehensive solution for managing guest check-ins, bidder numbers, item logging, dynamic item bundling, bid tracking, and post-event checkouts. Built for high-reliability under intense auction-night traffic, the app features robust offline-first and idempotent state synchronization with Google Sheets as its primary transactional datastore, backed by Firebase for dynamic configurations.

## Tech Stack

*   **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS (using fluid responsive utilities and design system components)
*   **Animations**: Framer Motion (`motion` from `motion/react`) for fluid and purposeful route/state transitions
*   **Backend**: Express (Node.js) server running as an ES module during development and compiled to a single, high-efficiency CJS bundle for production
*   **Datastore**: Google Sheets API (for core relational databases) combined with Firestore (the shared auction Config, staff roles, volunteers and other server-only records, read and written only by the server)
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
*   `/server/routes/`: Isolated REST endpoint pathways (`authRoutes.ts`, `bidRoutes.ts`, `bundleRoutes.ts`, `dataRoutes.ts` - which mounts `syncRoutes.ts`, `sweeperRoutes.ts`, `itemRoutes.ts`, `sheetsProxyRoutes.ts`, `driveRoutes.ts` - `health.ts`, `productionRoutes.ts`, `receiptRoutes.ts`, `setupRoutes.ts`, and others; see `file-reference.md`).
*   `/server/services/`: Global services such as `google.ts` (the Google API retry policy - GET/PUT/PATCH/DELETE only; POSTs that are safe to repeat opt in with `server/utils/googleRetry.ts`) and `genai.ts` (modern SDK configuration for Gemini assistant tools).
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
*   `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`: the **live** PayPal REST app's credentials ("Auction AI Receipts")
*   `SANDBOX_PAYPAL_CLIENT_ID` / `SANDBOX_PAYPAL_CLIENT_SECRET`: the **sandbox** PayPal REST app's credentials ("Auction Sandbox Test"). The server holds both, so **Settings > PayPal Integration**'s sandbox/live switch is all it takes to change PayPal - no server change. A mode whose pair is missing fails with an error naming it; it never uses the other pair. Locally, the sandbox pair is enough
*   `SWEEPER_TRIGGER_SECRET`: Shared secret Cloud Scheduler sends to `POST /internal/paypal-sweep` to run the PayPal sweep (see "Deployment"). Production only; leave it empty locally, which turns that endpoint off
*   `FLUENT_FORMS_WEBHOOK_SECRET`: Shared secret the Auction Tickets form's Webhook feed sends in an `X-ORNS-Webhook-Secret` header to `POST /api/webhooks/fluent-forms/tickets` (see "Fluent Forms ticket webhook"). Leave it empty locally, which turns that endpoint off
*   `FLUENT_FORMS_TICKETS_MODE` (optional): `write` makes the ticket webhook add rows to the tickets tab. Unset (the default) is shadow mode: it reports what it would do (Cloud Logging, `jsonPayload.fluentFormsWebhook`) and writes nothing. Set it to `write` only at the switch-over, when the form's Google Sheets feed is turned off - never run both as writers
*   `FLUENT_FORMS_SITE_URL`, `FLUENT_FORMS_API_USER`, `FLUENT_FORMS_API_PASSWORD` (optional): WordPress's REST API (`https://www.orns.org`, a dedicated WordPress user, its Application Password - keep the password in Secret Manager). The ticket webhook uses it to confirm a PayPal payment (see "Fluent Forms ticket webhook"); with any one unset the payment check is off. `FLUENT_FORMS_TICKETS_FORM_ID` (optional) defaults to `7`
*   `APPS_SCRIPT_DEV_MODE` (optional): `true` makes Apps Script calls run each script's latest *saved* editor code instead of its deployed API-executable version - only works for the script's owner; for trying `.gs` edits locally before deploying them. Default (unset/`false`) runs the deployed version - see "Deployment"
*   `DRIVE_TEMPLATE_FILES_FOLDER_ID`: The Auction/General Auction Info/Template Files folder, where Settings > Action History creates the master Action History spreadsheet (next to the master Bid Management and Item Entry spreadsheets)
*   `FULL_ADMIN_EMAILS`: Comma-separated @orns.org addresses that are always **Full Administrators** (`server/services/userService.ts`). They can't be demoted in the app, so nobody can lock every admin out; every other @orns.org address is a User unless given a role in Settings > Users. Administrators also open Settings (Configuration, Users, Action History - each in full, except that they give only the Administrator or User role and can't change a Full Administrator); the PayPal Integration, Google Apps Scripts and Bug Reports tabs are Full Administrators' only, and Users can only view the Auction Tickets page (`server/utils/permissions.ts`). Leave it empty and nobody can open Settings until someone is made an Administrator - set at least one address
*   `VOLUNTEER_GOOGLE_ACCOUNT`: The shared Google account volunteers' requests run as (`auction-volunteers@orns.org`). It is refused as a normal app sign-in. An Administrator connects it once from **Settings > Users > Volunteer Google Account > Connect** (its sign-in is kept in Firestore `system/volunteerAuth`). It needs **Editor** access to the Bid Management, Auction Items and Auction Tickets spreadsheets, the receipt and For Print folders, and the Action History spreadsheet - and to each new year's copies
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
4.  Run `gcloud auth application-default login` with an account that can access the `orns-auction-bid-management` Firebase project, so `firebase-admin` can reach Firestore. The server reads the PayPal sandbox/live setting from there, so without it checkout and receipt generate/email fail with "Couldn't read the PayPal sandbox/live setting" (and the sweeper status card can't load). Sign-in and the other screens still work. If those errors mention `invalid_rapt`/`invalid_grant`, the login has expired - run the command again.

Then `npm run dev` (or `npm run dev:watch` to auto-restart on backend edits) and open `http://localhost:<PORT>`.

**A local server works on live data.** It reads the same shared Config from Firestore (`settings/global`) as production, so it opens the same spreadsheets, and the in-app PayPal sandbox/live toggle is shared too. A local server never runs the PayPal sweeper on its own (only Cloud Scheduler triggers it, in production), so it won't touch the live Bidder-Numbers sheet unless you click **Run Sweep Now**. To test against throwaway data, point the Config screen at copies of the spreadsheets - and remember that changes it there for production too.

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
*   `npm run gas:stamp` / `gas:deploy` / `gas:check`: Apps Script tooling (`scripts/apps-script/cli.mjs`) - see "Deploying the Apps Scripts" under Deployment.
*   `npm run test:quiet`: Same as `npm run test` (kept as the name the docs use). `vitest.config.ts` passes `--no-experimental-webstorage` to every test worker - required on Node 22+, where Node's own Web Storage global hides jsdom's `window.localStorage` - so no `NODE_OPTIONS` is needed, in any shell.

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

The build steps are in [`cloudbuild.yaml`](../../cloudbuild.yaml) at the
repo root - the trigger reads it (since 2026-10-31), so a change to the
file is a change to how the app deploys:

- **One server copy only:** each revision gets `--max-instances=1`, and
  the service is capped at one too (service-level `maxScale: 1`). The
  app's locks, cache and live-refresh feed are in memory, so a second
  copy would let two writers race. Never raise either.
- **The newest 15 revisions are kept;** older ones are deleted after each
  deploy (a step that never fails the build).
- Only this build's image is pulled, which keeps builds to a few minutes.

Workflow:

1.  Do work on a branch, never directly on `main`.
2.  Run the tests (`npm run test:quiet`, `npm run lint`) and try the change locally (`npm run dev`).
3.  Merge to `main` (via a GitHub pull request) only when it's ready to go live - the merge is the deploy, live within a few minutes.

### Deploying the Apps Scripts

The three Apps Script projects (`scripts/GoogleAppsScriptsCode/<project>/`) do **not** deploy with the app. Each folder's `.clasp.json` holds the project's `scriptId` and the `deploymentId` the app runs (`SCRIPT_ID_*` on Cloud Run). After changing any file in one:

1.  `npm run gas:stamp` - updates each project's `Version.gs` fingerprint and `server/generated/appsScriptVersions.ts`. Commit both (a test fails until you do).
2.  `npm run gas:deploy` (or `npm run gas:deploy BidManagementSpreadsheet`) - pushes from the repo folder, creates a version, and points the deployment at it. Needs clasp signed in once: `npx @google/clasp@3.4.1 login`, as an account that owns the scripts.
3.  `npm run gas:check` - downloads each deployed version and compares it file by file with the repo.

The Items and Tickets scripts' `ActionHistoryTracking.gs` needs the `script.scriptapp` scope (to install its on-edit trigger), which is also in the app's sign-in scopes (`server/services/oauth.ts`). After deploying a script whose manifest scopes changed, staff must sign in again before the app can run that script.

The Settings page's **Apps Script Versions** card shows whether each live script reports the fingerprint the running app expects. "Out of date" right after a merge usually just means step 2 hasn't been run yet.

Production configuration (all the environment variables above, with
production values) is set on the `orns-auction-manager-gh` service in
the Cloud Run console, not in any file in this repo. Since 2026-10-28
the secret ones - `GOOGLE_CLIENT_SECRET`, `PAYPAL_CLIENT_SECRET`,
`SANDBOX_PAYPAL_CLIENT_SECRET` (since 2026-10-29), `SESSION_SECRET`, `GEMINI_API_KEY`, `SWEEPER_TRIGGER_SECRET`,
`FLUENT_FORMS_WEBHOOK_SECRET` - are Secret Manager secrets of the same
name, referenced by the service as `<NAME>:latest`, and
`FLUENT_FORMS_API_PASSWORD` comes from the secret
`fluent-forms-api-password` (Variables & Secrets > "Secrets exposed as environment
variables"); the service account
`firebase-adminsdk-fbsvc@orns-auction-bid-management.iam.gserviceaccount.com`
has Secret Accessor on each. To change one, add a new version of the
secret and deploy a new revision (a running instance keeps the value it
started with). Never add one back as a plain variable. The server binds
`0.0.0.0:$PORT`; Cloud Run terminates HTTPS in front of it, and
`app.set("trust proxy", 1)` is what lets Express treat those requests as
secure for the `orns_session` cookie.

**Required Cloud Run settings.** The server keeps several pieces of state
in process memory - the `bidder-numbers:` lock that prevents duplicate
PayPal invoices, the idempotency map, the sheet cache, the bug-report
rate limit - so the `orns-auction-manager-gh` service must run with
**Maximum instances = 1** (Scaling tab). With two instances, two requests
could each take "the" lock on different machines. Everything else stays
at the cheap defaults: minimum instances 0 and **Request-based** billing.

**Fluent Forms ticket webhook.** The Auction Tickets form (Fluent Forms
form 7 on orns.org) also sends each purchase to
`POST /api/webhooks/fluent-forms/tickets`
(`server/routes/webhookRoutes.ts`, ROADMAP W3), which hands it to
`upsertTicketPurchase` (one row per Fluent Forms entry ID). Set-up:

1.  Make a long random secret (`openssl rand -hex 32`) and set it as the
    service's `FLUENT_FORMS_WEBHOOK_SECRET`. Leave
    `FLUENT_FORMS_TICKETS_MODE` unset (shadow mode).
2.  In WordPress, Fluent Forms > Auction Tickets > Settings &
    Integrations, add a **Webhook** feed: request URL
    `https://orns-auction-manager.cloud.run/api/webhooks/fluent-forms/tickets`,
    method POST, format **JSON**, request header
    `X-ORNS-Webhook-Secret: <the secret>`, request body **Selected
    Fields** with exactly the keys in
    `server/services/fluentFormsWebhookPayload.ts`, each set to the same
    smart code the form's Google Sheets feed uses for that column (the
    input value, never the label), and `entry_id` set to
    `{submission.id}` (Entry Attributes). Leave `transaction_id` out -
    Fluent Forms offers no smart code for it. Turn on its payment events
    too, if offered.
3.  Submit a test entry and check Cloud Logging for
    `jsonPayload.fluentFormsWebhook` with `"outcome": "would-add"` (or
    `"exists"` once the Sheets feed's row is there) and a `read` that
    matches the entry (`total` in dollars - 70, not 7000), and the
    entry's API log in Fluent Forms for a 200.

It writes as the server's stored background Google sign-in (the one the
PayPal sweeper uses, refreshed by any staff sign-in); without one it
answers 503. Only at the switch-over: set `FLUENT_FORMS_TICKETS_MODE=write`
and turn the Google Sheets feed off.

**Ticket payments (W4).** After each delivery the webhook confirms the
row's payment (`checkTicketPayment`, `server/services/ticketPaymentCheck.ts`)
from the payment itself, never from what the delivery says: it reads the
entry's transactions from WordPress's REST API
(`GET /wp-json/fluentform/v1/submissions/resources?form_id=7&entry_id=N&orderData=1`,
`server/services/fluentFormsApi.ts`) and looks the PayPal transaction ID
up at PayPal (`PayPalService.getPayment`: the Captures API, then
Transaction Search for a PayPal Standard payment). Only a PayPal payment
that is completed, in USD, for the amount Fluent Forms recorded, and not
already used for another entry sets the row Paid; anything else goes on
the review list. Cash/check is left to staff, a Paid row never goes back
to Pending, and a refund PayPal confirms sets it Refunded and flags it. A
new website row always starts Pending. Set-up:

1.  In WordPress, add a user (e.g. `orns-auction-app`) with no other
    role, and in Fluent Forms > Global Settings > Managers give it only
    **View Entries** (`fluentform_entries_viewer`) and **View Payments**
    (`fluentform_view_payments`) for the Auction Tickets form. On its
    profile, create an **Application Password**.
2.  Put the password in Secret Manager (it's `fluent-forms-api-password`)
    and expose it to the service as `FLUENT_FORMS_API_PASSWORD` - the
    variable's name, not the secret's, is what the app reads; set `FLUENT_FORMS_SITE_URL=https://www.orns.org`
    and `FLUENT_FORMS_API_USER` to the user's login.
3.  In the PayPal developer dashboard, both REST apps the service holds
    (`PAYPAL_CLIENT_ID` live, `SANDBOX_PAYPAL_CLIENT_ID` sandbox) need
    **Transaction Search** turned on (done 2026-10-28) - PayPal Standard payments are only found there. The Settings
    sandbox/live switch picks which PayPal it asks, so a live purchase
    checked against the sandbox is never confirmed (it goes on the review
    list instead).
4.  Submit a test entry and check `jsonPayload.fluentFormsWebhook.payment`
    in Cloud Logging: `not-configured` means step 2 is missing, `error`
    carries the reason (a 401 from WordPress means the user or password).

**PayPal sweeper schedule (Cloud Scheduler).** The sweeper that checks
deferred credit-card checkouts against PayPal isn't a timer inside the
server - with request-based billing, Cloud Run throttles the CPU between
requests, and an always-on instance would cost money all year for an app
used one night a year. Instead a Cloud Scheduler job calls
`POST /internal/paypal-sweep` every 5 minutes
(`server/routes/schedulerRoutes.ts`), authenticated by the
`X-Sweeper-Secret` header matching the service's `SWEEPER_TRIGGER_SECRET`.
The job (`paypal-sweeper`, region us-east1):

*   Frequency `*/5 * * * *`, target type HTTP, URL
    `https://orns-auction-manager.cloud.run/internal/paypal-sweep`, method
    POST, header `X-Sweeper-Secret: <the secret>`, no auth header.
*   **Resume it before checkout opens; pause it after the auction.** The
    Settings page's PayPal Sweeper card shows "Running" while it's
    firing and "Paused" otherwise.

**Website ticket poll (Cloud Scheduler, ROADMAP W5).** A second job,
`fluent-forms-poll` (region us-east1), calls
`POST /internal/fluent-forms-poll` four times a day with the same
`X-Sweeper-Secret` header: frequency `0 6,11,16,21 * * *`, time zone
America/Chicago, URL
`https://orns-auction-manager.cloud.run/internal/fluent-forms-poll`,
method POST, attempt deadline 180s. It runs **all year** - unlike the
sweeper, leave it on. With nothing new on the website a run reads one
page of WordPress's entries list and nothing else (no Google, no PayPal),
so it costs nothing; while ticket sales are open it adds any purchase
whose webhook was missed (`pollTicketPurchases`,
`server/services/ticketPoll.ts`) and confirms PayPal payments (W4).
State is Firestore `system/fluentFormsPoll`: the season's first entry
(Setup New Auction Year moves it, so last year's purchases are never
re-added), the high-water mark, and the last run (also in Cloud Logging
as `jsonPayload.fluentFormsPoll`). Staff can run it on demand with the
Tickets page's **Check Now** button (`POST /api/tickets/fluent-forms/check-now`,
the auction-stage permission). It needs the Fluent Forms API (see
"Ticket payments (W4)") and answers 503 without it; a run with errors
answers 500. Set Up Bid Management App and Create Bidder Labels run it
first, so neither works from a list missing a purchase; a failed check
never stops them (`pollTicketPurchasesFirst`).

**Website Ticket Check (ROADMAP W6).** On the Tickets page's
**Website Ticket Check** tab, which confirms every ticket bought on the
ORNS website reached the app and its PayPal payment went through, for staff with the auction-stage permission
(`TicketPurchaseStatusCard`, from `GET /api/tickets/fluent-forms/status`;
volunteers don't get the tab). When it needs attention the tab itself
carries a pulsing amber dot (`AttentionDot`), so it's seen without
opening the tab. It shows "Needs Attention" when the poll hasn't succeeded in over 12
hours (two missed runs), the last run stopped with an error, the last
webhook failed, or a purchase is on the review list. It also lists the
entries the poll had to add (each one a missed webhook; in shadow mode,
entries missing from the sheet when checked) and website purchases
still Pending a week after they were bought.

**Purchases after Go Live (ROADMAP W7).** Once the auction is Live the
ticket sync no longer adds bidders, so a website purchase arriving then
(or after Close) gets a ticket row but no bidder number. Each one whose
row isn't tied to a Bidder-Numbers line is listed at the top of the
Website Ticket Check card - name, tickets, guests who want their own
number, paid online or paying at the door - and lights the tab's dot.
Staff register it as a walk-in, then click **Done**
(`POST /api/tickets/fluent-forms/after-go-live/:entryId/handled`,
auction-stage permission, in Action History). Kept in Firestore
`ticketPurchasesAfterGoLive`; Setup New Auction Year empties it. Works
in shadow mode too.

Cloud Scheduler's free tier covers 3 jobs per billing account (these are
2), and each run is a few seconds of Cloud Run CPU.

The service account also needs Firestore access (it already has it if
the PayPal sweeper status card works): the server reads the PayPal
sandbox/live setting from `settings/global` on every PayPal-touching
request, and refuses to make PayPal calls if it can't. It also writes
each winning bid's idempotency key to the `idempotency` collection for
24 hours, so a bid saved on a device while offline and resent later is
never recorded twice (`server/services/idempotencyStore.ts`). If
Firestore can't be reached, bids still record; they're just protected
by the in-memory map alone.

**Optional: let Firestore delete old idempotency records.** Each record
is a tiny document that's never read after 24 hours. To have Firestore
delete them on its own, add a TTL policy in **Google Cloud Console** (the
Firebase console has no TTL screen):
Firestore -> select the database
`ai-studio-8ae64d57-94f3-4e97-b086-1f1495b79131` (the app's named
database - `firestoreDatabaseId` in `firebase-applet-config.json` - not
`(default)`) -> **Time-to-live (TTL)** -> Create policy -> collection
group `idempotency`, timestamp field `expireAt`. The policy can be
created before the collection exists. Deletion happens within about a
day of `expireAt`, which is why the server also ignores expired records
itself. Without the policy the records simply accumulate (a few hundred
a year).

**Apps Script changes deploy separately.** The server calls each Apps
Script project's *deployed* API-executable version (`devMode: false`), not
the editor's latest saved code. After changing a `.gs` file, open that
script's editor -> Deploy -> Manage deployments -> the API executable
deployment -> Edit -> Version: **New version** -> Deploy. Until then the
app keeps running the previous version.

When the production URL changes (a new service or custom domain), the
OAuth client's **Authorized redirect URIs** (`<URL>/auth/callback`) in
Google Cloud Console must be updated or sign-in breaks.

**Firestore rules deploy separately.** `firestore.rules` denies browsers
everything (only the server, through firebase-admin, uses Firestore).
After changing it, run `npx firebase-tools deploy --only firestore:rules`
(it uses `firebase.json`'s named database); Cloud Build doesn't deploy it.

The app was originally built in Google AI Studio, which ran it inside an
iframe and deployed it to a separate Cloud Run service
(`orns-auction-manager`, domain `orns-auction-manager.ai.studio`). That
service, if it still exists, is a retired fallback that no longer
receives updates; AI Studio is no longer part of development or
deployment.
