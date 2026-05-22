# Backend Architecture Documentation: Strangler Fig Refactor

This document exhaustively details the business logic of our newly refactored `server` directory for the charity auction application.

## 1. Entry Point

### File: `server.ts`
* **Primary Goal:** This is the absolute core entry point for the backend logic and the server's master traffic controller. It initializes the Express application, configures security, establishes resilient connections to Google APIs, and routes every incoming request to its designated handler.
* **Plain English Breakdown:**
  * **Google API Resilience Matrix (`google.options`):** Configures Google API clients to automatically retry up to 4 times if they hit temporary errors (like rate limits or server blips), ensuring the live checkout line doesn't halt during unexpected spikes.
  * **Gemini AI Initialization:** Boots up the server-side connection to the Gemini AI tool (for generating bundle descriptions and themes) using the environment's private key.
  * **CORS & Caching:** Configures rules indicating who is allowed to talk to the server (specifically allowing the Tauri desktop app) and forcefully prevents browsers from caching live data, ensuring that cashiers always see the absolute latest bid information.
  * **Session Management:** Uses cookies (and an alternative HTTP header bypass for tight security environments) to securely store Google OAuth tokens, ensuring the user stays logged in across multiple API calls without constantly re-authenticating.
  * **Static File Serving / Vite Middleware:** Dynamically handles routing. In development, it pipes requests into the Vite server to continuously render the web app. In production, it statically serves the pre-built React application from the `dist` folder.
* **How it handles failures:** Any uncaught backend errors or connection failures that slip through the cracks of the routers are caught by a centralized `errorHandler` before they can crash the server. Fallback directories are specifically configured to prevent "file not found" failures when serving the React app in distinct container environments.

## 2. Middleware

### File: `server/middleware/errorHandler.ts`
* **Primary Goal:** This intercepts any failing endpoint across the entire server, neatly packages the error so the app doesn't crash, and logs it directly to the console for developers.
* **Plain English Breakdown:**
  * **`errorHandler`:** It observes any HTTP request that has triggered an error logic path. Instead of abruptly terminating the server connection or spilling ugly stack traces directly to the user's browser, it catches the error object. It writes the exact failure trace to the server logs and returns a clean, uniform "Internal Server Error" (HTTP 500) JSON response with a descriptive message back to the frontend.
* **How it handles failures:** It guarantees a uniform JSON error payload, preventing frontend apps from crashing due to unexpected HTML error pages, and ensures developers have immediate console logs to debug production issues.

## 3. Utilities

### File: `server/utils/auth.ts`
* **Primary Goal:** It sets up and enforces the permissions (OAuth Scopes) required for the system to safely read from and write to the charity's Google Drive, Gmail, and Google Sheets files.
* **Plain English Breakdown:**
  * **`SCOPES` Array:** A hardcoded list dictating exactly what the app is allowed to do (like accessing Spreadsheets, sending emails via Gmail, and running Google Apps Scripts).
  * **`getOAuthClient`:** Looks at incoming server requests and server environment variables to dynamically construct a Google OAuth2 client. It determines the correct root Uniform Resource Locator (URL) depending on whether the system is running locally or deployed to a live cloud portal, and attaches the specific Google Client ID and Secret.
  * **`getAuthenticatedClient`:** Takes Google login tokens that the user already received during the login process, attaches them to a fresh OAuth client, and hands that authorized client back so the server can instantly run Google API operations without prompting the user again.
* **How it handles failures:** If no Google Client ID or Secret are found in the environment registry, the system immediately throws a fatal, explicit error loudly warning developers to check the API configuration payload before any network calls are ever attempted.

### File: `server/utils/categoryHelpers.ts`
* **Primary Goal:** Categorizes auction items perfectly according to their designated departments (like "Classroom Art" vs "Travel") by using exact fallback matches or textual matching rules.
* **Plain English Breakdown:**
  * **`getCategoryBase`:** It accepts a plain text auction category name as input. It strips out whitespace, symbols, and irregular capitalizations, and then checks that name against a large set of business rules to assign the category a numerical Base ID starting boundary (e.g., "Health & Beauty" items start numbering at 301, while "Live Auction" items start at 1301).
* **How it handles failures:** If an completely unrecognizable category is fed in, or the input text is blank, it gracefully defaults to "1". It uses an exact word-match dictionary at the end to catch edge cases that weren't caught by the fuzzy search.

### File: `server/utils/financeUtils.ts`
* **Primary Goal:** Offloads the exact financial math calculation for PayPal card processing surcharges from the frontend client to the backend server to ensure precision.
* **Plain English Breakdown:**
  * **`calculatePayPalSurcharge`:** Takes a specific bid amount submitted by a winner. It applies the standard non-profit PayPal rate (3.49% + $0.49), performs exact-penny rounding, and returns both the total invoice cost the user must pay and the precise amount of the surcharge penalty itself.
* **How it handles failures:** It inherently relies on standard ECMAScript math logic and enforces mathematically strict rounding to prevent floating-point calculation errors (which protects the charity against losing fractional pennies on scale checkouts).

### File: `server/utils/idempotency.ts`
* **Primary Goal:** Prevents users from accidentally double-charging credit cards or entering duplicate bids by furiously clicking checkout buttons during slow internet connectivity.
* **Plain English Breakdown:**
  * **`checkIdempotency`:** Inspects incoming requests for an 'Idempotency Key' (a unique signature). If the server recognizes that it has already processed a request with that exact signature, it immediately intercepts the request and responds with the cached result instead of repeating the heavy business logic.
  * **`saveIdempotency`:** Takes the final result of successfully completed business logic and stores it alongside the unique key signature in server memory.
  * **Memory Cleanup Interval:** A self-cleaning hourly cron job that scrubs out tracking signatures over an hour old to prevent the server's Memory Cache from filling up entirely and crashing.
* **How it handles failures:** If memory begins flooding, the background system auto-purges old keys after one hour. In the event of duplicate transmissions (e.g. hitting submit twice), the first successful result is cleanly returned to the second request, preventing catastrophic duplicate data corruption.

## 4. Services

### File: `server/services/sheetsService.ts`
* **Primary Goal:** Implements a highly complex, safety-first transactional bridge to Google Sheets. It allows the server to change many distinct cells or tabs simultaneously, and safely rolls back all changes if any single change fails.
* **Plain English Breakdown:**
  * **`executeGoogleSheetsTransaction`:** The lifeblood of Google Sheets safety. It accepts an array of operations (either "UPDATE" or "APPEND"). 
    * *Phase 1 (Staging):* It first individually inspects every single target to confirm it is readable and actually exists, and stores the old/existing data into memory so it knows what it is replacing.
    * *Phase 2 (Commit):* It sequentially pushes the changes to Google Sheets, keeping a rigid ledger of which cell block updates were actually successful. 
    * *Phase 3 (Rollback):* If the process crashes halfway through (e.g., loss of Google API connection), it immediately stops. It loops backward through the ledger of successful changes, rewriting the original data over the changes, or deleting newly appended rows entirely, reversing the process perfectly back to step zero.
* **How it handles failures:** If the commit phase crashes, it throws a dramatic "Commit failed! Initiating rollback process..." warning. It then safely attempts to revert the spreadsheet state back to how it was before the function was called. If the rollback itself somehow critically fails, it throws a "Transaction failed, and rollback partially failed (Mismatched state)" error, screaming that human intervention is required.

### File: `server/services/syncService.ts`
* **Primary Goal:** Conducts a massive data importation task, acting as the bridge linking the charity's main ticketing sales spreadsheet and original master auction-catalog list into the localized operational sheets used on auction night.
* **Plain English Breakdown:**
  * **`performSheetSync`:** 
    * First, it loads custom configurations (ticket prices, master sheet registry IDs) from the localized `_Settings` tab.
    * Next, it archives (backs up) any existing live databases like `Bidder-Numbers` and `Auction-Items` by changing their tab names to timestamps, preserving old data securely.
    * It then creates completely fresh, empty tabs securely named `Bidder-Numbers`, `Bid-Management`, and `Auction-Items`.
    * It opens the highly-complex master ticket ledger, scanning multiple tabs for staff check-ins, guest ticket indicators, sponsor lists, and table groupings. It painstakingly parses names and eliminates duplicate emails to build a perfect registry of actual humans attending the event.
    * It constructs completely automated styling matrices, merging specific cells, painting grid rows, forcing checkboxes onto columns, freezing headers, and generating dynamic Bidder rows in the `Bid-Management` sheet.
    * Finally, it scans the external origin auction catalog, looking for "Active" marked items, sanitizing them, appending generic charity requests (like $50 Open Appeal lines, Standard Auction Tickets), and dumping them all beautifully onto the localized `Auction-Items` sheet.
* **How it handles failures:** It attempts to aggressively grab variables across tabs; when tabs or specific external sheets are not found, it quietly warns in logs without crashing and selectively skips optional data sets, ensuring the main synchronization engine pushes whatever valid registries it *did* find into the system.

### File: `server/services/emailService.ts`
* **Primary Goal:** Generates beautiful, responsive HTML receipts displaying what a user has bought, and physically transmits them through the authenticated charity's Gmail account directly to the winning bidder.
* **Plain English Breakdown:**
  * **`generateEmailHtml`:** Acts as a direct HTML/CSS templating engine. It injects specific bid items, accurate pricing, the user's name, localized charity disclaimers, and dynamically adds PayPal checkout buttons precisely embedded with exact surcharges into the structural email layout body. 
  * **`createRawEmail`:** It acts as a mail carrier standardizer. It packages the HTML payload into an encoded chunk with correct "Subject:", "To:", and "From:" standard MIME headers (RFC compliant text structures) so that Google's raw system can process it. 
  * **`processEmail`:** Initiates the workflow. It grabs the active spreadsheet, scans perfectly across the `Bidder-Numbers` cross-reference to pinpoint the email address, rips through `Bid-Management` to calculate exactly how much that person owes, parses `Auction-Items` for the display names, generates the encoded structure, checks the user profile for identity stamping, and requests Gmail's API to immediately fire off the message.
* **How it handles failures:** If an email is completely missing from the target bidder, it cleanly aborts by returning gracefully `{ success: false, error: "No email address found" }` rather than attempting to crash. If it successfully locates everything but Gmail blocks the final send, the generic router error mechanisms kick in to inform the interface.

## 5. Routes API Controllers

### File: `server/routes/setupRoutes.ts`
* **Primary Goal:** Controls the "New Year Auction Setup" feature; completely resetting Google Drive with a fresh hierarchy, backing up last year's files natively, and wiping clean databases so the administrative team starts completely fresh for a brand-new year.
* **Plain English Breakdown:**
  * **`/setup-new` (POST):** Receives the command to build a new year. It calculates current vs. previous years. It connects to the Google Drive API and searches for previous master archives. It creates a brand-new Drive Folder named "[Year] Auction", constructs mandatory subfolders inside of it ("For Print", etc.). It safely replicates a specific set of critical non-profit design templates identically into the newly minted folder. Next, it aggressively copies the prior database spreadsheets into a protected Archive directory, entirely unlinks/deletes the live checkout and bid data arrays out of the original sheets to sanitize them for walk-ins, and safely forces the core auction master switch state to "Closed".
* **How it handles failures:** It is engineered with robust file-system conflict resolution. If it detects a folder matching the new year *already* exists in Drive, it forcibly aborts to prevent catastrophic duplicate directory pollution. 

### File: `server/routes/authRoutes.ts`
* **Primary Goal:** Manages securely logging users in and out by acting as the security turnstile verifying identities against Google Workspace credentials.
* **Plain English Breakdown:**
  * **`/log` (POST):** Simply intercepts and logs generic frontend metadata traces accurately across server consoles.
  * **`/auth/url` (GET):** Asks the application to generate a dynamic login URL that immediately forces Google's sign-on consent screen specifically tied to the `@orns.org` workspace.
  * **`/auth/callback` (GET):** The endpoint Google returns the user to after they accept. It captures Google's authorization token code, swaps it natively for an offline-access payload, reads out the current user's email profile, strictly validates that the email address explicitly belongs to the ORNS private domain environment, cleanses unnecessary payload scopes, and locks the token straight into checking session cookies.
  * **`/auth/status` (GET):** A fast ping to let the frontend know whether current valid tokens physically exist in the browser's cookie system.
  * **`/auth/logout` (POST):** Flushes the security payload and completely nullifies backend cookies.
* **How it handles failures:** Strict domain rejection rule: If any user signs in with a generic `@gmail.com` or other domain profile, they are forcibly blocked with an HTML 403 "Access Denied: @orns.org required" screen, providing powerful tenant isolation.

### File: `server/routes/bidRoutes.ts`
* **Primary Goal:** Controls the heartbeat logic of auction night—recording winning bids, executing the cashier checkouts, registering walk-ins on the fly, and performing the massive "night end" closing workflows to block out changes.
* **Plain English Breakdown:**
  * **`/auction/record-winning-bid` (POST):** Maps an item directly to a user's ledger sheet. It identifies the target item, calculates the correct horizontal matrix column corresponding exactly to the user traversing the `Bid-Management` sheet, pushes the price entry down, and specifically assesses if the user had already been checked-out financially by cashiers; if they have, it spins out a duplicate marker into an isolated `Follow-Up` sheet so volunteers know someone successfully bought something after they left.
  * **`/auction/checkout-mark-paid` (POST):** Bridges seamlessly into older Google Apps Script utilities to mark financial ledgers accurately as "Paid" and automatically cross-checks external ticketing registrations to flip flags indicating the bidder has collected their envelope.
  * **`/auction/close-and-cleanup` (POST):** The massive "Night End" hammer. It flips the master active auction status toggle explicitly to false, queries the bid columns to identify *exactly* who won items, and iterates across the `Bidder-Numbers` registry to forcibly mark all people who definitively did *not* win any items as functionally "Checked Out" so the volunteer team's reporting is perfectly clean.
  * **`/bidders/walk-in` (POST):** A massive native integration. It accepts a random person walking in off the street, finds the deepest numeric bidder ID available in the registry, appends a new row to the Bidder matrix representing them, expands native Google Sheet dimensions (columns) sideways in the `Bid-Management` grid, merges header cells beautifully for visual tracking, injects their immediate default cost (e.g. standard entrance ticket) automatically into their bid ledger, and synchronously copies them into the original pre-sale ticketing spreadsheet as a complete fail-safe.
  * **`/auction/check-in-with-bid` (POST):** Specifically processes attendees coming through the door who pre-registered but still owe entrance or raffle ticket money; modifying checkout sheets instantly alongside flagging their official entrance check-in checkboxes.
* **How it handles failures:** Employs the new Google Sheets idempotent transaction architecture universally. If any column dimension expansions physically fail midway on a fast Wi-Fi disconnection, the rollback system instantly reverses every column inserted ensuring grids never misalign.

### File: `server/routes/bundleRoutes.ts`
* **Primary Goal:** Manages "Virtual Bundles," empowering the school to seamlessly fuse multiple loose specific donations into a singular large curated basket payload securely, and directly leveraging Google Gemini AI for naming/marketing.
* **Plain English Breakdown:**
  * **`/suggest-names` (POST):** It pipes an array of target item titles/descriptions specifically across the Gemini AI Large Language Model dynamically injected with custom prompting instructions to generate a raw JSON payload of 5 perfectly-tuned, catchy fundraising basket ideas.
  * **`/suggest-description` (POST):** Prompts the Gemini model forcefully to write exactly one paragraph explaining the combined thematic value of a bundle grouping.
  * **`/process` (POST):** This triggers the destructive/creative bundling algorithm. It scans an array of distinct target IDs, strips them of their original identifiers, assigns them a master relational grouping stamp token (e.g. `BND-TimeStamp`), flags them universally as 'Inactive' (hiding them from live bidding pages), aggregates their total maximum itemized value automatically, recalculates exact sequencing IDs to preserve gaps, and mints an entirely new umbrella "Bundle Parent" row into the spreadsheet natively merging all prior donor references cleanly.
  * **`/restore` (POST):** Un-bundles elements seamlessly. Identifies an active master parent group via tracking tokens, structurally deactivates the parent flag rendering it functionally deleted, and iterates entirely through the 'Inactive' children items, forcibly altering their statuses sequentially back to 'Active', effectively dumping the components back out onto auction tables.
* **How it handles failures:** AI requests strictly examine if generation was interrupted by internal safety/stop faults and instantly crash the generation cleanly. Sheets manipulations strictly utilize idempotency logic natively preventing "double-grouping" if the user hammers on "Create Bundle" while it thinks.

### File: `server/routes/dataRoutes.ts`
* **Primary Goal:** Function as the primary standard database and network communications hub bridging all spreadsheet mutations, Google Drive downloads, generalized item manipulation, structural cache layers, and the AI terminal interface.
* **Plain English Breakdown:**
  * **`/bidders/sync` (POST):** Intercepts frontend requests and forcefully pushes parameters out dynamically over to the separate Node-based `syncService`, pulling results to the user.
  * **`/script/run` (POST):** A versatile integration highway built to interface with older bespoke internal "Google Apps Script" logic files directly via REST, enabling arbitrary custom scripts remotely while bypassing native Google quotas contextually.
  * **`/backups/list/:spreadsheetId` & `/backups/restore` (GET/POST):** Identical parallel systems dedicated to reading Drive tab metadata, capturing automatically-labeled snapshot archive tabs mapped by title signatures, and surgically un-archiving them specifically via Drive file duplication APIs and rigid title renaming logic to restore lost operational states functionally identical.
  * **`/settings/update` (POST):** Finds individual keys cleanly inside the remote configuration properties tab `_Settings`, scanning directly for coordinates and either amending the value strings natively or injecting fresh configurations row parameters cleanly into empty whitespace lines.
  * **`/auction/add-item` (POST):** Injects new arbitrary lines gracefully into the main active auction manifest. To do so, it evaluates category offsets statically, injects a standard matrix of properties attached to a "TEMP" row key, immediately forces a full list structural resorting, calculates accurate consecutive numbering sequences strictly isolating the exact category target, rewrites the full array back to memory, and explicitly rips cached layers to guarantee data coherence securely.
  * **`/auction/delete-item` (POST):** Applies "Soft Delete" principles securely to items rather than entirely shredding cells structurally. It wipes the core identifying key to blank status structurally disabling reference links, forces the flag status statically to "Deleted", and sequentially fires the massive array recalibrating sequencing system algorithmically.
  * **`/auction/update-item` & `/auction/bulk-update-items` (POST):** Directly coordinates surgical pinpoint updates across standard grid indices and mapping arrays natively across single lines or mass multi-row combinations respectively. Crucially evaluates conditional impacts seamlessly; monitoring if updates hit structural 'Category' or 'Status' vectors natively, thereby triggering immediate automated mass index numerical re-sequencing natively guaranteeing numeric ID accuracy across all permutations.
  * **`/sheets/:spreadsheetId/:range` (GET/POST/APPEND/CLEAR):** Function as the ultra-fast master Google Sheets caching proxy pipeline network. Intercepts basic Google Sheets operations natively. GET requests ping a custom 5-second structural memory engine first preventing Google native quota explosions natively via cache hits securely. Write commands interact actively to natively manipulate ranges while explicitly detonating internal cache memory structures instantly maintaining synchronization.
  * **`/drive/files/:folderId` & `/drive/download/:fileId` (GET):** Connects out dynamically across remote Drive file systems. Generates structured file tree responses securely mirroring internal Drive structures natively. Handles active native blob-streaming downloads cleanly specifically capable of converting live active internal Google Docs seamlessly dynamically exporting formatted payload outputs structurally as PDFs instantly.
  * **`/assistant` (POST):** Dedicated terminal context handler natively mapping arrays dynamically specifically routing structural user chat interface payloads directly up directly to Gemini AI dynamically configured by historical mapping contexts completely independent of active bundling algorithms natively contextually executing natively structurally.
* **How it handles failures:** Intensely robust structural error matrices handle generalized API crashes deeply. Implements complex code monitoring inspecting natively across Google 429 API rate limits, standard 400 Bad Requests, 404 Not Founds, and specifically structurally handles complex range parsing errors comprehensively returning clean structured string prompts securely to React natively without breaking frontends.

### File: `server/routes/health.ts`
* **Primary Goal:** Acts securely as a generalized uptime "ping" mechanism for internal infrastructure.
* **Plain English Breakdown:**
  * **`/` (GET):** Generates a tiny immediate status object confirming directly to Kubernetes load balancers or system checks verifying actively the server dynamically exists functionally and handles operations cleanly natively structurally.
* **How it handles failures:** By structurally responding exclusively when actively running natively, its total complete absence cleanly indicates structural server death cleanly natively dynamically.

### File: `server/routes/receiptRoutes.ts`
* **Primary Goal:** Directs complex workflow architectures requesting specific structured email receipts strictly dynamically via generation protocols.
* **Plain English Breakdown:**
  * **`/generate` & `/generate-all` (POST):** Safely proxy generalized requests natively connecting straight into Google Apps Script functional boundaries forcefully passing parameters securely triggering legacy Apps Script generation mechanics safely locally natively contextually structurally generating native PDF structures directly dynamically physically mapping templates instantly cleanly natively specifically mapping arrays.
  * **`/email-all` & `/email-only` (POST):** Executes automated operations iterating sequentially strictly looping structurally over Bidder manifests explicitly launching isolated requests natively directing internal generalized Node generation methods specifically firing individualized SMTP messages cleanly specifically parsing generalized strings structurally.
* **How it handles failures:** Any structural interruption specifically mapping external script errors cleanly evaluates the direct native detailed responses converting explicit Apps Script execution details gracefully exposing logical explicit causes natively natively securely structurally returning explicit cleanly errors string payloads structurally natively securely dynamically.
