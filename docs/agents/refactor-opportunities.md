# Refactor Opportunities

Running list of concrete, verified work items for this codebase - not
aspirational ideas, but things confirmed against the real code. When an
item is done, remove it from this file entirely - the paper trail for
completed work lives in [`CHANGELOG.md`](./CHANGELOG.md), not here. This
file only ever reflects the current, outstanding backlog. Net-new
feature work belongs in [`ROADMAP.md`](./ROADMAP.md) instead.

---

## Tasks To Refactor

**2026-09-02 deep audit**: bugs, dead code, redundancy, and test-coverage
gaps, verified directly against real code. Sorted by severity within
each area.

**2026-09-04 standards audit**: measured against `component-standards.md`,
`patterns.md`, `react-patterns.md`, `style_guide.md`,
`tailwind-style-guide.md`, `testing-philosophy.md` - three parallel
passes, findings independently spot-verified against real code before
being logged here (one claimed finding, a supposed `h-[650px]`
duplication between `DataTableWrapper.tsx` and `Items.tsx`, turned out
on inspection to be a docblock comment illustrating the prop next to its
one real usage site, not an actual second call site - dropped rather
than logged). This pass also found `component-standards.md` and
`react-patterns.md` each citing "known gaps" (no `IconButton`/
`LoadingButton`/`ConfirmationDialog`/table wrapper, six oversized
components) that had already been closed by feature work since those
docs were last verified - corrected directly in both docs rather than
logged here, since the fix was the doc text itself, not a backlog item.

### Redundant/duplicated logic

Nothing outstanding right now - every item flagged in the 2026-09-02
deep audit's "Redundant/duplicated logic" section has been closed. See
`CHANGELOG.md` for the individual fixes.

### Code quality

Nothing outstanding right now - every item flagged in this section has
been closed. See `CHANGELOG.md` for the individual fixes.

### Test coverage gaps (`testing-philosophy.md`)

Nothing outstanding right now - every gap and SHALLOW/CIRCULAR/SMOKE-rated
test flagged in this section has been closed. See `CHANGELOG.md` for the
individual fixes.

### Code Hardening

1. **Eliminate Bid Management's separate Items snapshot.** Right now the Items that live in the Items Spreadsheet are capable of living independently from the Items that are listed in the Bid Management Spreadsheet. This was never an intentional thing, and only exists in its current state because of the fact that the 2 spreadheets had separate workflows — but the items, in the ideal world, would always stay in sync. We should harden the codebase so that this is a true statement. Since the app has access to all the items in the Items spreadsheet, there really is no need for the Bid Management spreadsheet to have this separate sheet that could — in theory — drift apart from the official Items spreadsheet. We should look into changing all necessary workflows to account for this fact and then ensure that no current workflows are impacted by this change. This will probably mean we'll need to update the GAS files. This change will most likely affect the checkout process, the receipt process, and anywhere else where the GAS scripts from the Bid Management sheet would grab the information from the Item sheet within that spreadsheet. When we do this, we want to ensure that the app doesn't lose the Items tab in the Bid Management page.

   Research (3 parallel explorations, cross-checked against the real code) has already been done and a full implementation plan drawn up - recorded here verbatim so it isn't lost before implementation:

   **Context**

   The Bid Management spreadsheet currently keeps its own copy of the auction items (a sheet also named "Auction-Items", confusingly, but living inside the *Bid Management* spreadsheet) instead of always reading from the real, single source of truth — the separate Auction Items spreadsheet. This copy is a one-time snapshot taken only when "Set Up Bid Management App" runs, so anything added, renamed, or deactivated in the Items spreadsheet afterward silently never shows up anywhere Bid Management looks.

   The copy is lossy on top of being stale: it's reduced to 3 columns (ID, Item Name, Type) with an "Active only" filter, plus 11 hardcoded standard-item rows appended — so even at the moment it's written, description/value/opening bid/min raise/donor/bundle info are already gone. This causes a concrete, observable bug today: staff recording a winning bid in `BidEntry.tsx` for an item added *after* the last sync get "Please fill in a valid item number" even though the item is real, because `BidEntry.tsx` looks the ID up against this stale copy.

   **Root cause, precisely**

   - *Who writes the copy:* `server/services/syncService.ts`'s `performSheetSync`, "Sync Step 7" (~lines 517-627). Triggered only by `POST /api/bidders/sync` (the "Set Up Bid Management App" button), a manual, effectively one-time action per auction (re-running it is already guarded against once any walk-in bidder exists). It opens the *separate* Items spreadsheet (`auctionImportSheetID`) alongside the Bid Management spreadsheet in one operation, fuzzy-header-maps ID/Name/Type/Status, filters to `Active`, appends hardcoded standard items, and overwrites Bid Management's own `Auction-Items!A1` with a 3-column result.
   - *A dead, parallel legacy version of the same idea already exists in GAS:* `scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_AuctionItemManager.gs`'s `ensureAuctionItemsSheet()` / `addStandardAuctionItems_()` / `removeExtraAuctionItemInfo_()`. Confirmed via grep across the whole `.gs` tree: nothing calls these anymore (the spreadsheet's custom menu was disabled in an earlier hardening pass) — they're inert leftovers from before `performSheetSync` took over the job.
   - *Who reads the stale copy today:*
     - **Client**, all via `AuctionContext.tsx` → `useItemsData(bidManagementSpreadsheetId, config.auctionItemsSheet)`: `Items.tsx` (the Bid Management "Items" tab), `BidEntry.tsx` (item-ID lookup when recording a winning bid), `Dashboard.tsx` (item count), `Checkout.tsx` via `useWinnersList` (resolves each won item's **name** only — price always comes from the recorded bid, never from an items catalog).
     - **Node**: `server/services/emailService.ts`'s `processEmail` (the email-receipt path) reads `'Auction-Items'!A:Z` off the *same* `spreadsheetId` as Bid Management — a second, independent Node-side name lookup, parallel to the GAS one below.
     - **GAS**: `Class_AuctionItemManager.gs`'s `getItemName(id)`, whose only caller is `Class_ReceiptManager.gs:116` (`buildReceipt_`) — this feeds both the printed/PDF receipt *and* the PayPal invoice line-item names (`getOrCreateInvoiceUrl` builds PayPal line items straight from the receipt's resolved names/prices).
     - Confirmed **not** affected: `recordWinningBid`/`checkoutMarkPaid` (`server/services/auctionService.ts`) never look up item details server-side — `itemId`/`price` pass through opaque from the client, so no fix is needed there. `PayPalSweeper.gs` and `Class_PayPalService.gs` have no Items-sheet dependency at all.

   **Why the fix is smaller than it looks — existing infrastructure to reuse**

   - `src/hooks/useAuctionItems.ts` already does exactly "fetch live, full-fidelity items from a spreadsheet ID" — it's what the top-level Auction Items workflow (`AuctionItemsTab.tsx`) already uses against `config.auctionItemsSpreadsheetId`. It shares `src/lib/itemParsing.ts`'s `parseItemRows` with `useItemsData.ts`, so it returns the exact same `AuctionItem` shape — this is a drop-in replacement, not a new mechanism.
   - Config already carries both spreadsheet IDs together — `config.auctionItemsSpreadsheetId` and `config.bidManagementSpreadsheetId` are sibling fields on the same `Config` object (`src/types.ts`, `src/context/ConfigContext.tsx`) — no new client-side ID plumbing needed.
   - `performSheetSync` already opens two spreadsheets in one operation (`spreadsheetId` + `auctionImportSheetID`), proving the `googleapis` Sheets client isn't bound to "one spreadsheet per request" — the same shape of change is safe to make in `emailService.ts`.
   - The GAS cross-spreadsheet-read pattern already exists in this codebase: `scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/Class_BidderManager.gs`'s `getAllBidders(bidManagementSpreadsheetId)` was rewritten in an earlier hardening pass (see `docs/agents/CHANGELOG.md`) to open another spreadsheet live by ID instead of trusting a local copy, with an `overrides.*` constructor-injection point for testability, hard-failing on a missing ID or an empty cross-read, but soft-falling-back for one unmatched record. This is the template to mirror in the opposite direction (Bid Management → Items spreadsheet).
   - Even better: the GAS settings plumbing for this already exists. `Class_AuctionItemManager.gs`'s (currently dead) `getAuctionImportSheet_()` already does `SpreadsheetApp.openById(this.config['auctionImportSheetID'])` — and `auctionImportSheetID` is already one of `GlobalVariables`' `requiredKeys`, loaded from Bid Management's own `_Settings` tab on every execution. **No new GAS settings key is needed** — `getItemName()` just needs to actually use this helper instead of reading a local sheet.
   - `server/test/helpers/loadGasClass.ts` + the `overrides` DI convention (see `server/test/gs-tickets-bidder-manager.test.ts`) is the established way to unit-test a rewritten GAS class via a `vm` sandbox without touching real spreadsheets.

   **Recommended approach**

   1. *Client: point Bid Management's item data at the live Items spreadsheet.*
      `src/context/AuctionContext.tsx`: replace `useItemsData(spreadsheetId, config.auctionItemsSheet)` with `useAuctionItems(config.auctionItemsSpreadsheetId)`. Wire its `items` into the context value as before, and its `refresh` into `fetchAllData`'s `Promise.all` in place of the old `fetchItems()` call. `Items.tsx`/`BidEntry.tsx`/`Dashboard.tsx`/`Checkout.tsx` need **no changes** — they only ever consumed `useAuction().items: AuctionItem[]`, and `useAuctionItems` returns that same shape. Delete now-unused `src/hooks/useItemsData.ts`. Retire the now-meaningless `config.auctionItemsSheet` setting (it named a sheet tab *inside Bid Management* that no longer gets read): remove it from `src/types.ts`'s `Config` interface, its default in `src/context/ConfigContext.tsx`, its persistence in `src/hooks/useConfigSettingsState.ts`, and its input field in `src/components/AuctionConfigurationCard.tsx`.
      2. *Node: point the email-receipt path at the live Items spreadsheet.* `server/services/emailService.ts`'s `processEmail(client, spreadsheetId, bidderId)` needs a new `itemsSpreadsheetId` parameter; its `aucItems` read (currently `sheets.spreadsheets.values.get({ spreadsheetId, range: "'Auction-Items'!A:Z" })`) should target `itemsSpreadsheetId` instead of `spreadsheetId`. The existing header-based column detection (`getCol`, with safe positional defaults) needs no logic changes — it will just see the full master schema (a strict superset of the old 3-column copy) instead of the stale copy. Thread `itemsSpreadsheetId` through the call chain: `receiptService.ts`'s `processAllEmails`, `receiptRoutes.ts`'s `/email-all` and `/email-only` (accept it in the request body), and the client callers (`src/hooks/useCheckoutReceiptActions.ts`, `useCheckoutBatchActions.ts`) so they pass `config.auctionItemsSpreadsheetId` from `Checkout.tsx`. The Google-Doc/PDF receipt path (`/generate`, `/generate-all`) needs **no** Node-side change — it's a self-contained Apps Script call handled in step 3.
      3. *GAS: make `Class_AuctionItemManager.gs` read the Items spreadsheet live.* Rewrite `getItemName(id)` to open the master Items spreadsheet via the already-existing `getAuctionImportSheet_()` helper (reads `this.config['auctionImportSheetID']`, already loaded from Bid Management's own `_Settings` tab — no new setting needed), instead of `this.activeSpreadSheet.getSheetByName(this.auctionItemsString)`. Look up the sheet named `"Auction-Items"` with a fallback to the workbook's first tab (mirroring `syncService.ts`'s own existing fallback), and read positionally per the master schema already defined in `scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItem.gs` (id = column A / index 0, name = column C / index 2 — a fixed, documented layout, so no header-sniffing needed). Failure-mode convention, mirroring `Class_BidderManager.gs`'s precedent: throw a clear, actionable error if `auctionImportSheetID` is missing/blank or the spreadsheet can't be opened at all (a systemic misconfiguration — worth surfacing loudly rather than silently printing "Unknown Item" on every line of every receipt); keep the existing graceful `'Unknown Item'` fallback when the read succeeds but one specific item ID just isn't found (a genuine per-item data issue, not a systemic one). Add an `overrides.itemsSpreadsheet` constructor-injection point, matching `Class_BidderManager.gs`'s `overrides.bidManagementSpreadsheet` convention exactly, so this stays unit-testable via the `vm`-sandbox harness. Delete the now-fully-dead legacy methods: `ensureAuctionItemsSheet()`, `addStandardAuctionItems_()`, `removeExtraAuctionItemInfo_()`, and the `auctionItems` getter tied to the local sheet — confirmed unused anywhere else in the `.gs` tree. `Class_GlobalVariables.gs`: remove the now-unused `this.auctionItemsString = 'Auction-Items'` constant (only the deleted dead code referenced it).
      4. *Stop writing the drifting copy at all.* `server/services/syncService.ts`'s `performSheetSync`: remove "Sync Step 7"'s Auction-Items-copy-and-write block (~lines 517-627), and the backup/recreate-sheet bootstrapping for a local `Auction-Items` sheet (~lines 331-421) — nothing will read or need that sheet inside Bid Management going forward. Adjust surrounding step numbering/comments. Check `server/services/auctionSetupService.ts`'s year-rollover flow (`/setup-new`), which currently deletes the Bid Management spreadsheet's `"Auction-Items"` sheet for a fresh year — this becomes unnecessary once the sheet is never created there in the first place; remove that step too.

   **Explicit scope boundaries (not part of this item)**

   - Visually redesigning `Items.tsx` — that's the separate "UI / Layout Tweaks" backlog item below (reusing the Attendee List's look app-wide). This fix only changes *where the data comes from*, not how it's displayed.
   - Item #2 below ("look through the rest of the app for other hardening opportunities") is a separate, broader item not addressed here.

   **Verification**

   - *Tests to update:* `server/test/syncService.test.ts` (verify sync-related fixtures still pass once Sync Step 7 is deleted - none currently assert on the item-catalog-copy logic directly, but check for incidental coupling); `server/test/bid-management.test.ts` (remove the currently-unused `"Auction-Items"` mock branch - dead scaffolding, not tied to a real assertion today); `src/components/Items.test.tsx`, `src/components/BidEntry.test.tsx`, `src/hooks/useAuctionItems.test.ts` (check/update any mocks tied to the old `useItemsData`/`AuctionContext` wiring).
   - *New tests:* `server/test/gs-bidmanagement-auction-item-manager.test.ts` — Node `vm`-harness tests for the rewritten `getItemName()`, following `server/test/gs-tickets-bidder-manager.test.ts`'s exact convention: live lookup from a fake Items spreadsheet via `overrides.itemsSpreadsheet`, `'Unknown Item'` fallback for an unmatched ID, thrown error on a missing `auctionImportSheetID`, thrown error on an empty cross-read. A matching native-tier `scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/AuctionItemManager_UnitTests.gs` with its own `runAuctionItemManagerUnitTests()` entry point, mirroring `BidderManager_UnitTests.gs`'s existing convention. Sanity-check discipline per this repo's established convention: for the core `getItemName()` rewrite, revert and confirm the new test fails with the real symptom, then restore.
   - *Full verification pass* (per this repo's standard convention): `npm run lint` (`tsc --noEmit`), backend suite (`npx vitest run server/test/`), frontend suite (`NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/`), `npm run build`, mojibake check on touched files, then a `docs/agents/CHANGELOG.md` entry (noting the reference-copy `.gs` files need manual re-copy into the live Bid Management Apps Script editor, per this repo's existing convention for `.gs` changes) and removing this item from this file.
   - *Manual/functional check:* after implementing, add a new item to the Items spreadsheet *without* re-running "Set Up Bid Management App", then confirm it's immediately visible in the Bid Management "Items" tab and can be looked up by ID in `BidEntry.tsx` — this is the exact drift scenario the fix eliminates.

2. We should look through the rest of the app and try and find any other areas in which the app would benefit from rethinking how we are doing things and then try and find a way to harden the workflow.
3. **Move Bid Management's pure data/sync GAS logic into Node.** A full pass over every `.gs` file in `scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/` (21 files, ~3,750 lines), specifically looking for logic that's pure data/API manipulation with no genuine dependency on running inside Apps Script - as opposed to logic that needs Docs/Drive/UI APIs or Google's own trigger infrastructure, which should stay in GAS. Two of the strongest candidates turned out to already be **duplicated** between GAS and Node right now, which is itself a live correctness risk (the two copies can silently diverge), not just an architecture preference.

   **Strong candidates (pure logic, already duplicated in Node - highest priority):**

   - **`Class_PayPalService.gs`** is a pure PayPal REST API HTTP client (`UrlFetchApp.fetch` calls only - no `SpreadsheetApp`/`DocumentApp`/`DriveApp` anywhere in the class): OAuth token exchange (`getAccessToken_`), `createAndSendInvoice`, `cancelInvoice`, `recordOfflinePayment`, `getInvoiceStatus`, `extractInvoiceIdFromUrl`, and `calculatePayPalSurcharge`. **This last method is byte-for-byte duplicated** with `server/utils/financeUtils.ts`'s `calculatePayPalSurcharge` - same percent rate (0.0349), same fixed fee ($0.49), same rounding - two independent implementations of the exact same fee math that could drift apart with one careless edit to either file. The rest of the class (invoice CRUD, offline-payment recording, live status polling) has **no Node equivalent yet** - `server/services/paypal.ts`-style Node code only calculates/display the fee today, it never talks to PayPal's API directly. Moving this whole class into a Node `paypalService.ts` (using `fetch` instead of `UrlFetchApp`, PayPal credentials as env vars instead of `PropertiesService` script properties) would consolidate the fee math into one place and let checkout/reconciliation logic call PayPal directly from Node instead of bridging through Apps Script.
   - **`Class_GoogleAIStudio.gs`'s `recordPayment`** (bridged via `apiRecordPayment`, called by `server/services/auctionService.ts`'s `checkoutMarkPaid` today): pure `Bidder-Numbers` sheet read/write (checked-out/paid columns, invoice URL/amount columns) plus calls into `PayPalService`. Nothing here needs Apps Script - it's already effectively "Node calls into GAS to do a sheet write Node could do itself" once `PayPalService` is ported per above.
   - **`Class_ReceiptManager.gs`'s pure-data methods** - `findBidderColInBidSheet_`, `getEmailForBidder_`, `buildReceipt_`, `calculateAdjustedTotalWithFees`, `getPaymentLink`, `getOrCreateInvoiceUrl` (all plain `Bid-Management`/`Bidder-Numbers` sheet reads plus arithmetic, no Doc/Drive calls) - compute the exact same "which items did this bidder win, what do they owe, what's their PayPal link" logic that `server/services/emailService.ts`'s `processEmail` **already reimplements independently** for the email-receipt path. Right now there are two parallel, hand-written implementations of "resolve a bidder's winning items and total" - one in GAS (feeds the printed/PDF receipt and the PayPal invoice), one in Node (feeds the emailed receipt) - with no shared source of truth.
   - **`Class_EmailManager.gs` + `Class_Email.gs`** duplicate `emailService.ts`'s email-receipt feature entirely, via a *different* code path (`GmailApp.sendEmail` from GAS, triggered when `createIndividualReceipt`'s `emailReceipt` flag is true) than the Node `/email-only`/`/email-all` routes' `processEmail`/`gmail.users.messages.send`. Confirmed these render **visibly different HTML templates** for what a bidder would reasonably expect to be the same "email my receipt" feature - worth flagging as a product-consistency issue on top of the code duplication: a bidder emailed via one path sees a different-looking receipt than one emailed via the other.

   **Moderate candidate (pure logic, but needs new Node infrastructure to migrate):**

   - **`PayPalSweeper.gs`'s `checkPendingPayPalInvoices`** - pure `Bidder-Numbers`/`Follow-Up` sheet read/write plus `PayPalService` calls, no Docs/Drive/UI dependency at all. The only genuinely GAS-specific piece is *how it runs*: a time-driven Apps Script trigger, which executes on Google's infrastructure under the spreadsheet owner's own account at zero extra hosting cost. Porting this to Node is only worth it if the app already has (or the team is willing to stand up) a persistent, always-on Node process with its own scheduler (e.g. `node-cron`) - otherwise this is the strongest argument for keeping *something* in GAS, per the earlier discussion in this conversation about not doing a wholesale migration.

   **Not candidates - confirmed genuinely GAS-native, should stay put:**

   - `Class_DocService.gs`, `Class_DriveService.gs`, `Class_ReceiptDoc.gs` - real `DocumentApp`/`DriveApp` document generation (headers, inline images, QR codes, PDF conversion). Technically reachable from Node via the Docs/Drive REST APIs, but this is document-rendering logic tightly coupled to the Docs object model, not "pure data/sync logic" - a materially bigger, separate lift if ever attempted, not part of this item.
   - `Class_UIManager.gs`, `Class_UIStrings.gs`, `menu.gs` - spreadsheet-native UI (`SpreadsheetApp.getUi()`); `menu.gs`'s custom menu is already disabled/inert per an earlier hardening pass.
   - `Class_GlobalStyles.gs` - shared font/color constants consumed only by the Doc/email generators above; moot once/if those move, irrelevant otherwise.
   - `Class_AuctionItemManager.gs` - already covered by item #1 above (its fix is "read live from the Items spreadsheet," not "move to Node" - `getItemName()` needs to stay in GAS since its only caller, `Class_ReceiptManager.gs`, is itself Doc-generation-coupled).
   - `Class_BidderManager.gs` - already a cross-spreadsheet-read success story from an earlier hardening pass (see `CHANGELOG.md`); its `getSortedBidderData_` is called by `Class_GoogleAIStudio.gs`'s `createAllReceipts`, which is itself Doc-generation-coupled, so it stays alongside that.

4. **Auction Items (Items) spreadsheet's GAS - same pass, notably different result.** Checked every `.gs` file in `scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/` (17 files, ~2,130 lines) for the same "pure data/sync logic with no genuine dependency on Apps Script" pattern as item #3. Unlike Bid Management, **this project turned out to be a poor migration candidate almost across the board** - it has no checkout/payment/sync bridge logic at all; `Class_GoogleAIStudio.gs` (the API bridge Node calls) exposes exactly eight functions, and every single one of them exists purely to trigger a Doc/Slides generator (`createBundlingDoc`, `createItemLabels`, `createSlideshow`, `createBiddingGuideCoverPage`/`createBiddingGuideInnerPages`, `createBidSheets`, `createCatalog`, `createTableTents`, feeding `BundlingMeetingDoc`/`PackagingLabelsDoc`/`LiveAuctionSlides`/`BiddingGuideDoc`/`BidSheetDoc`/`CatalogDoc`/`TableTentDoc` respectively). This spreadsheet's whole GAS project is a print/slide-generation pipeline, full stop.

   - **`Class_AuctionItemManager.gs`'s `getValidSortedItems()`** (filters out `inactive`/`deleted` status, sorts numerically by ID) and **`Class_AuctionItem.gs`** (a plain row-to-object data model, zero Apps Script API calls at all) are, in isolation, pure logic - but their *only* consumers are the Doc/Slides generators listed above, which themselves must stay in GAS. Moving just the data-fetching piece to Node wouldn't remove any GAS dependency here, unlike Bid Management's `PayPalService`/`ReceiptManager` case where Node already independently needed the same computation for a Node-side consumer (the email-receipt path). Low priority to migrate on its own.
   - Checked specifically for the kind of already-existing duplication found in item #3 (a real, live divergence risk) and **found none of comparable severity**: the Doc generators (`BidSheetDoc.gs`, `CatalogDoc.gs`, `BiddingGuideDoc.gs`) only print `item.value`/`item.openingBid`/`item.category` literally - they don't recompute anything Node also computes. Node's `src/lib/categoryHelpers.ts`'s `getCategoryBase()` (used only to assign new item ID number ranges in the item-entry app) has no GAS counterpart at all - the Doc generators never reassign IDs, so this isn't a duplicate. `Class_BundlingMeetingDoc.gs` only prints a blank hand-annotation table for the bundling team's in-person meeting - it doesn't perform any bundling itself, so it doesn't overlap with `server/services/bundleService.ts`'s real bundling/resequencing logic. The one minor, low-stakes overlap: `Class_AuctionItem.gs`'s row-to-object field mapping (12-column positional schema: id/category/name/description/value/openingBid/minRaise/donatedBy/phyOrCert/status/bundleID/bundleTimeStamp) is the same schema `src/lib/itemParsing.ts`'s `parseItemRows` already encodes in TypeScript - not a computation that could silently diverge (it's a straightforward positional map, not a formula), but the same shape is defined in two languages if either sheet's column order ever changes.
   - `menu.gs` is already disabled/inert, matching the same policy applied to Bid Management's and Tickets' menus.
   - **Conclusion: no action recommended here.** This spreadsheet's GAS code is doing what GAS is genuinely good at (generating printable Docs/Slides from spreadsheet data) and isn't hiding any Node-worthy sync logic or live duplication risk the way Bid Management's PayPal/receipt code was.

### UI / Layout Tweaks

1. We should look into making all of the pages have a more visually appealing and user-friendly design. We should use the newly created Attendee List table on the Auction Tickets page as inpiration — and keep that same visual feel to it.

---

## Passed Audit Inspection

Checked directly against the standards docs and confirmed correct -
listed so future audits don't have to re-derive this, and so nobody
"fixes" something that isn't broken.

- **No native `<select>`** outside test-mock files (`component-standards.md`) -
  every real dropdown goes through `src/components/ui/select.tsx`.
- **Winner-notification toast rule implemented correctly**
  (`patterns.md`) - the `duration: Infinity` + `"I have confirmed"`
  action pattern is present in `Bidders.tsx`, `Checkout.tsx`,
  `Dashboard.tsx` (×2), and `ConfigSettings.tsx`'s analogous manual-copy
  confirmation.
- **Bundle restoration and category re-sequencing are server-side and
  correct** (`patterns.md`) - `server/services/bundleService.ts` sets a
  restored bundle to `"Inactive"`, clears its sequential ID, and calls
  `resequenceCategoryIds()` on both the create- and restore-bundle
  paths.
- **PayPal surcharges are never calculated client-side** (`patterns.md`) -
  lives only in `server/services/paypal.ts` /
  `server/utils/financeUtils.ts`.
- **Session cookie name is `orns_session`, not `__session`**
  (`patterns.md`) - confirmed in `server/app.ts` and
  `server/routes/authRoutes.ts`.
- **`vite.config.ts`'s `manualChunks` is a functional matcher**, not a
  static object map (`patterns.md`, `performance.md`).
- **`firebase`'s init is lazy-loaded, out of the critical path**
  (`performance.md`) - `ConfigContext.tsx` defers `firebase/app`/`auth`/
  `firestore` behind a memoized `getFirebase()` (`src/services/firebase.ts`)
  instead of importing them statically. The deferred chunk itself grew
  (106 kB → 160 kB gzipped) since neither `@firebase/auth` nor
  `@firebase/firestore` declares `"sideEffects": false`, so Rollup can't
  tree-shake their unused exports across an async boundary the way it
  partially could in one static graph - confirmed via a
  `rollup-plugin-visualizer` treemap, and `firebase/firestore/lite`
  isn't a viable swap (it's REST-only; this app's config sync needs
  `onSnapshot`). Accepted trade-off: the critical path is what matters
  for `performance.md`'s budget, and it dropped either way (see
  `CHANGELOG.md`).
- **Route-level `React.lazy()` code-splitting is in place** for
  `ConfigSettings`, `AuctionTicketsWorkflow`, `AuctionItemsWorkflow`,
  wrapped in `<Suspense>` (`performance.md`, `style_guide.md`).
- **No direct `fetch()` calls outside `src/services/google-api.ts`**
  (`react-patterns.md`) - every network call goes through
  `fetchWithRetry`/`getBaseUrl`.
- ~~No derived-state duplication anti-pattern~~ **Correction (2026-09-04
  audit)**: this claim didn't hold - `useConfigSettingsState.ts:43-46`
  does exactly this. Moved to "Code quality" above as an open item
  rather than left here as a false "passed" claim.
- **Memoization applied where it matters, skipped where it doesn't**
  (`performance.md`, `react-patterns.md`) - `hooks/useAuctionItemsTableState.ts`
  and `hooks/useBiddersState.ts` wrap their filter/sort in `useMemo`
  (the latter's filter also does an O(n×m) `getBidderAttendeeInfo()`
  scan); lighter filters elsewhere correctly run unmemoized in render.
- **`useEffect` usage stays scoped to real external synchronization**
  (`react-patterns.md`) - 1-3 effects per file, none computing a value
  that could live in render.
- **Bare `.toHaveBeenCalled()` usage is not itself a shallow-assertion
  problem** (`testing-philosophy.md`) - every occurrence is either a
  `.not.toHaveBeenCalled()` negative assertion or
  `server/test/middleware.test.ts` confirming `next()` fired, neither of
  which has a meaningful payload to check. (Other shallow-assertion
  patterns - `expect.anything()`, asserting one field out of many,
  asserting call count but never arguments - were found in the
  2026-09-02 deep audit; see "Test coverage gaps" above.)

---

## Out of Scope, but Should be Fixed

Nothing outstanding right now.

---

## How to use this file

- Touching a file that also has an open item here? Fold the fix in -
  but don't turn an unrelated bug fix into a drive-by rewrite of an
  unrelated file.
- Log new findings the same way: concrete evidence (line count, grep
  hit, failed command), sorted into the right section above - not a
  vague "this could be cleaner."
- When an item is finished, remove it from this file entirely and
  record what happened in `CHANGELOG.md` instead. This file only ever
  shows the current, outstanding backlog - never a history of what's
  already done.
