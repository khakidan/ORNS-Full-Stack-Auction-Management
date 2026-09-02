# Backend Architecture Documentation: Completed Strangler Fig Refactor

This document exhaustively details the architecture, design patterns, and operational business logic of the modularly refactored `server` backend directory for our charity auction application.

---

## 1. Entry Point & Bootstrapping

Historically consolidated, the entry point and startup logistics have been cleanly separated into three highly focused modules to guarantee that environment configuration, Google API defaults, and application server loops boot in a strict, predictable order.

### File: `server.ts`
* **Primary Goal:** To act as the pristine, lightweight single entry point. It coordinates bootstrap sequencing by ensuring environmental setup and globally resilient client settings are established before any express application pathways are loaded.
* **Plain English Breakdown:**
  * **Resilient Dependency Seeding:** Imports and evaluates `server/services/google` to set global options before any sheet/drive requests are compiled under routing.
  * **Dynamic Environment Parsing:** Synchronously calls `dotenv.config()` before accessing any `process.env` configuration properties across downstream files.
  * **Safe Validation & Init Executions:** Checks if all strict conditions are satisfied by executing `validateEnv()` to block booting with broken keys. Once validated, it invokes `startServer()` on our configured Express instance.
* **How it handles failures:** It immediately terminates execution at step-zero with exit flags if dependencies fail parsing or required variables are missing, protecting the container from starting in a corrupt or semi-initial state.

### File: `server/boot.ts`
* **Primary Goal:** Directs the physical server creation, hot-module development support, static file path serving fallback routines, and port listeners.
* **Plain English Breakdown:**
  * **`startServer` Lifecycle Controller:** Accepts ready-initialized `Express.Application` and port variables as inputs.
  * **Interactive Vite Development Pipeline:** Statically evaluates the active `NODE_ENV`. If running in development, it imports Vite dynamically and mounts it as the main SPA middleware so that React code modifications hot-reload seamlessly.
  * **Production Static Serving Matrix:** In production container environments, it loops across multiple directory fallback matrices (e.g., standard path, parent folders, or working folders) to locate the compiled React static bundle. It serves static assets from there and implements single-page application fallback routing to `index.html`.
  * **Listener Binding:** Firmly binds the finalized server to listen on host `0.0.0.0` at Port `3000` to satisfy network forwarding rules.
* **How it handles failures:** Uses robust `try-catch` structures when determining paths and logs precise fallback directory targets to standard console streams so operators can immediately troubleshoot file-serving permission blocks inside Cloud Run or Docker.

---

## 2. Global Services

### File: `server/services/google.ts`
* **Primary Goal:** Implements a global resilience matrix across our outbound Google API traffic to survive transient network degradation or rate limiting.
* **Plain English Breakdown:**
  * **Global Retries Hook (`google.options`):** Automatically intercept every outbound request dispatched by the `googleapis` SDK. It injects a uniform policy that automatically retries failed transactions up to 4 times, applying an exponential backoff delay of 1000ms.
  * **Intelligent Filter Rules:** Restricts retries strictly to safe, idempotent HTTP methods (`GET`, `PUT`, `POST`, `PATCH`, `DELETE`) and handles transient HTTP status codes (e.g., 429 Rate Limits and 5xx Server Errors).
* **How it handles failures:** Prevents checkout failures and keeps the donor transaction queue active even if Google Sheets temporarily throttles the server during concurrent peak bids.

### File: `server/services/genai.ts`
* **Primary Goal:** Constructs and exports a single, ready-to-use, isolated singleton instance of the official modern Gemini AI SDK.
* **Plain English Breakdown:**
  * **GoogleGenAI Initialization:** Boots a dedicated client utilizing the `process.env.GEMINI_API_KEY`.
  * **Header Security Injection:** Explicitly configures headers (such as `'User-Agent': 'aistudio-build'`) inside the underlying HTTP client options, ensuring standard telemetry tracking is isolated to secure service envelopes.
* **How it handles failures:** Guarantees initialization fails predictably if keys are absent from our env registry; lazy evaluations and clean imports prevent routing controllers from using undefined instances.

---

## 3. Middleware

Our middleware components intercept incoming and outgoing API traffic to format states, enforce cookies, and secure network boundaries.

### File: `server/middleware/errorHandler.ts`
* **Primary Goal:** To intercept any failed endpoint across the entire server, log exact traces safely, and prevent backend execution crashes from halting client interactions.
* **Plain English Breakdown:**
  * **`errorHandler` Sentinel:** Observes any request that falls into error pathways. It writes complete, detailed trace errors strictly to server console logs and sends a uniform, clean HTTP 500 JSON response with a clear message back to the frontend.
* **How it handles failures:** Guarantees that the frontend React UI always receives structured JSON error payloads instead of ugly, raw HTML stack pages, preventing consumer-facing components from locking up.

### File: `server/middleware/cacheControl.ts`
* **Primary Goal:** Forcefully stops browser caches and CDN edge proxies from caching dynamic API data.
* **Plain English Breakdown:**
  * **`cacheControl` Interceptor:** Automatically appends HTTP Headers (`Cache-Control`, `Pragma`, `Expires`) to all outgoing server responses, forcing intermediate CDNs (like Firebase Hosting CDN) to immediately forward and process real cookies and headers.
* **How it handles failures:** Ensures cashiers, auction tables, and bidders always fetch the true live data state of bidder ledgers and item registries.

### File: `server/middleware/cookiePolicy.ts`
* **Primary Goal:** Overrides cookie session secure/sameSite flags dynamically depending on whether the server receives requests from embedded frames or raw top-level tabs.
* **Plain English Breakdown:**
  * **Adaptive Cookie Constraints:** Safely intercepts and evaluates incoming `host` and frame-context headers. If it identifies requests originating from sandboxed development environments or embed previews (like the AI Studio web-application workspace iframe), it automatically sets cookie policies to secure SSL states and allows cross-origin frame communications (`SameSite: "None"`). If executing normally, it uses lax fallback protocols.
* **How it handles failures:** Works gracefully via isolated try-catch assertions, casting the underlying request objects carefully to bypass rigid Express interface limitations without risking execution-interrupting runtime exceptions.

### File: `server/middleware/tokenRestorer.ts`
* **Primary Goal:** Bypasses cookie block limits in highly strict browser environments by parsing session state strings from alternative HTTP request headers.
* **Plain English Breakdown:**
  * **Header Token Restoration:** If clean browser iframe restrictions drop incoming cookie payloads, it scans the incoming headers specifically for custom parameters such as `x-google-tokens`. When detected, it manually decodes and maps them back into the active server session buffer before authentication checks are executed.
* **How it handles failures:** Prevents users from being unexpectedly logged out when switching tabs or using sandboxed layout engines.

---

## 4. Utilities

### File: `server/utils/auth.ts`
* **Primary Goal:** Configures and enforces direct OAuth secure boundaries required to access the charity's physical spreadsheets and send transactional email receipts.
* **Plain English Breakdown:**
  * **Mandatory GCP Scopes:** Restricts authentication access uniquely to limited spreadsheet ranges, Drive download vectors, and Gmail dispatcher scopes.
  * **`getOAuthClient` / `getAuthenticatedClient`:** Returns custom authorized client environments by evaluating dynamic OAuth tokens generated by donor registration portals.
* **How it handles failures:** Explicitly triggers early fatal errors loudly across server consoles if required client identifiers are absent from environment configurations during bootstrapping.

### File: `server/utils/validateEnv.ts`
* **Primary Goal:** Shuts down bootstrapping instantly if core variables are missing.
* **Plain English Breakdown:**
  * **Strict Checking Loops:** Loops over a rigid list of critical production variables (including `SESSION_SECRET`, `GEMINI_API_KEY`, and Sheets Script IDs). If any variable is missing, it exits the Node process immediately.
* **How it handles failures:** Protects against production silent failure loops where missing configuration would otherwise lead to delayed runtime crashes during checkout.

### File: `server/utils/categoryHelpers.ts`
* **Primary Goal:** Automatically groups auction items into designated tracking bands (e.g. "Travel" vs "Classified Art") based on standardized numbering.
* **Plain English Breakdown:**
  * **`getCategoryBase` Classifier:** Maps category names to numeric starting values (e.g., Live Auction items begin at 1301).
* **How it handles failures:** Gracefully outputs a standard numeric string "1" if names are blank or unrecognized, protecting the sequencing logic from failing.

### File: `server/utils/financeUtils.ts`
* **Primary Goal:** Restricts all PayPal processing balance math and surcharges to a strict, single-source-of-truth service to avoid drift.
* **Plain English Breakdown:**
  * **Payment Surcharges:** Leverages `PayPalService.calculatePayPalSurcharge` natively on the backend workspace to accurately calculate non-profit PayPal rates (3.49% + $0.49). It provides clean, rounded dollar figures back to invoice generators.
* **How it handles failures:** Relies on standardized ECMAScript math and strict penny rounding, protecting the charity from losing margins to micro-penny rounding drifts.

### File: `server/utils/idempotency.ts`
* **Primary Goal:** Prevents double-checkouts or duplicate bid insertions if callers repeatedly hammer transaction buttons due to slow connections.
* **Plain English Breakdown:**
  * **Transaction Key Caches:** Tracks incoming dynamic idempotency tokens. If recognized, it returns the cached success payload without executing underlying Google API writes twice. An automated background cleanup runs every hour to manage memory usage.
* **How it handles failures:** If memory hits limits, the hourly cleanup purges older keys. It returns the original execution receipt on duplicate hits, keeping spreadsheets clean.

---

## 5. Sheets, Email & Sync Engines

### File: `server/services/sheetsService.ts`
* **Primary Goal:** Implements a strict, transactional transactional bridge for Google Sheets, supporting rollback operations if multi-row writes break.
* **Plain English Breakdown:**
  * **`executeGoogleSheetsTransaction`:** 
    * *Staging:* Measures ranges and backs up existing cells from the target spreadsheet into a temporary memory log.
    * *Commit:* Pushes the requested operations (updates/appends).
    * *Rollback:* If any operation fails during execution, the transaction halts and rolls back, writing the original backup data back to restore the prior spreadsheet state perfectly.
* **How it handles failures:** Emits structured warnings if commits fail and attempts automatic restoration. If rollback restoration hits fatal blocks, it throws a secondary warning to flag the mismatch for immediate human oversight.

### File: `server/services/syncService.ts`
* **Primary Goal:** Orchestrates background syncs across the main master ticket sheets, check-in registries, and catalog structures into active live night spreadsheets.
* **Plain English Breakdown:**
  * **Sheet Synchronizations:** Safely renames old tabs to timestamp configurations for auditing, builds new operational structures, reads sponsor, staff, and buyer details from ticketing sources, and generates dynamic sheets, checkboxes, and margins.
* **How it handles failures:** Gracefully warns of missing optional tabs or sheets instead of crashing, ensuring core attendee arrays are successfully loaded and written to active databases.

### File: `server/services/emailService.ts`
* **Primary Goal:** Accesses user details, computes item purchases, attaches PayPal QR invoices, and dispatches rich transactional emails via Gmail.
* **Plain English Breakdown:**
  * **Mail Assembler:** Packages details into standard RFC/MIME compliant string patterns and triggers GMail API dispatchers.
* **How it handles failures:** Aborts gracefully with `{ success: false, error: "..." }` payloads if attendee emails are blank, preventing mailing blocks.

---

## 6. Routes & Controllers

The modular Express routing engines mount API handlers to deliver dedicated functional gateways.

### File: `server/routes/setupRoutes.ts`
* **Primary Goal:** Supports start-of-year administrative operations—creating backup folder hierarchies on Google Drive and unlinking parent elements.
* **Plain English Breakdown:**
  * **`/setup-new` Reset Endpoints:** Provisions structured folders, copies boilerplate templates, and cleanly wipes old spreadsheets so operations boot on a clean slate.
* **How it handles failures:** Halts operations safely if it detects existing directories for the current year, preventing accidental data loss.

### File: `server/routes/authRoutes.ts`
* **Primary Goal:** Enforces organization-specific domain barriers on authentication flows.
* **Plain English Breakdown:**
  * **Domain Validation Check:**Swaps token credentials callback packages, reads user identities, and rejects non-tenant emails (outside `@orns.org`) with a strict 403 Forbidden page.
* **How it handles failures:** Enforces isolated session clearing if invalid access is detected, ensuring server and user security.

### File: `server/routes/bidRoutes.ts`
* **Primary Goal:** Records live auction records, performs walk-in registration on-the-fly, expands columns, and manages checkout status toggles.
* **Plain English Breakdown:**
  * **Live Bid Management:** Automatically pushes recorded bids to matching columns on the `Bid-Management` sheet. It detects if a checked-out bidder receives a new bid and records those occurrences to a dedicated `Follow-Up` sheet.
  * **Column Scaling & Registration:** Safely scales spreadsheets horizontally during new walk-in arrivals, merging header coordinates and assigning automated bidder numbers.
* **How it handles failures:** Relies on transactional spreadsheets. If a horizontal column expansion fails, the system immediately rolls back, keeping columns aligned.

### File: `server/routes/bundleRoutes.ts`
* **Primary Goal:** Allows virtual catalog bundling, joining multiple physical items under parent bundles, and leverages Gemini models for naming and descriptions.
* **Plain English Breakdown:**
  * **Language Model Pipelines:** Pipes titles and descriptions to `genAI` to generate marketing lines. It maps children items as "Inactive" on checkout, and recalculates category sequencing IDs.
* **How it handles failures:** Implements idempotency blocks to prevent identical target items from being grouped multiple times.

### File: `server/routes/dataRoutes.ts`
* **Primary Goal:** Serves as the primary database routing hub, managing Drive operations, file exports, automated sync triggers, and backups.
* **Plain English Breakdown:**
  * **Spreadsheet & Drive Proxies:** Delivers fast metadata reads. It integrates a 5-second caching layer for GET requests to prevent Google API quota exhaustion, and clears the cache layout instantly on any write payload.
  * **Resequencing Audits:** Checks that item identifiers are sequential and without gaps when categories are changed or deleted.
* **How it handles failures:** Automatically handles standard rate limits and parsing blocks, translating them into human-readable prompts for UI feedback.

### File: `server/routes/receiptRoutes.ts`
* **Plain English Breakdown / Workflow Rules:**
  * Coordinates custom PDF processing and checkout routines.
  * **`apiSendAllEmails` Call:** Scans winning items, computes PayPal invoice totals automatically including surcharges, updates columns J and K inside `Bidder-Numbers`, and dispatches unique checkout links.
  * **`apiCreateAllReceipts` & `apiCreateIndividualReceipt` Call:** Generates corresponding files, reads stored checkout URLs from physical sheets, and embeds checkout QR codes within the user documents.
* **How it handles failures:** Evaluates external App Script failures, converts them to clear error payloads, and relays them to the UI so operators can troubleshoot in real-time.

### File: `server/routes/health.ts`
* **Primary Goal:** Delivers lightweight availability probes.
* **Plain English Breakdown:**
  * **Uptime Responders:** Serves as a fast, simple `/` route verifying basic application responsiveness for hosting servers and local monitors.
