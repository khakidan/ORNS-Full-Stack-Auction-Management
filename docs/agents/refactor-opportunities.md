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

1. We should look through the rest of the app and try and find any other areas in which the app would benefit from rethinking how we are doing things and then try and find a way to harden the workflow.
2. **Move Bid Management's pure data/sync GAS logic into Node.** A full pass over every `.gs` file in `scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/` (21 files, ~3,750 lines), specifically looking for logic that's pure data/API manipulation with no genuine dependency on running inside Apps Script - as opposed to logic that needs Docs/Drive/UI APIs or Google's own trigger infrastructure, which should stay in GAS. Two of the strongest candidates turned out to already be **duplicated** between GAS and Node right now, which is itself a live correctness risk (the two copies can silently diverge), not just an architecture preference.

   **The end state this is working toward**: every `.gs` file in this project should either (a) receive already-resolved data from Node and turn it into an artifact (a Doc, Slide, PDF, label) and do nothing else, or (b) be a background service that has no business being "data Node fetches on request" in the first place (the sweeper - see Step 4). Nothing should be left reading a sheet just to make a financial decision or mutate checkout/invoice state - Node already has full Sheets API read/write access, so there's no technical reason for that split to exist. The steps below are ordered - each one after Step 1 depends on it, since they all need a Node-side PayPal client to call into.

   - [x] ~~`Class_ReceiptManager.gs`'s pure-data methods (item/total resolution)~~ **Done - see `CHANGELOG.md`.** `findBidderColInBidSheet_`, `getEmailForBidder_`, and `buildReceipt_` (which used to duplicate `server/services/emailService.ts`'s `processEmail`) are gone; Node resolves a bidder's winning items/total itself (`server/services/receiptDataService.ts`, also now shared by `processEmail`) and hands the finished data into `apiCreateIndividualReceipt`/`apiCreateAllReceipts` as a parameter - the same pattern used for bidder labels.

   - [x] ~~**Step 1 - Port `Class_PayPalService.gs` to Node.**~~ **Done - see `CHANGELOG.md`.** `server/services/paypalService.ts` now mirrors `getAccessToken_`/`createAndSendInvoice`/`cancelInvoice`/`recordOfflinePayment`/`getInvoiceStatus`/`extractInvoiceIdFromUrl` exactly, reading `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`/`PAYPAL_IS_SANDBOX` env vars and reusing `financeUtils.ts`'s existing `calculatePayPalSurcharge` (not re-ported). 28 tests in `server/test/paypalService.test.ts`. Nothing calls it yet - that's Steps 2-4 below.
     - **New: an in-app sandbox/production toggle exists now, ahead of schedule** - `Config.paypalIsSandbox` (`src/types.ts`, default `true`), settings-page UI in `src/components/PayPalIntegrationCard.tsx`, synced via the normal Firestore `saveConfig` path. **Steps 2-4 below must read `config.paypalIsSandbox` and pass it as the `isSandbox` override to `new PayPalService(...)`** on every call site they add - not rely on the `PAYPAL_IS_SANDBOX` env var default - so a real bidder never gets a live invoice/email because of a stale deploy-wide env var.

   - [x] ~~**Step 2 - Finish `Class_ReceiptManager.gs`: move invoice creation into the same Node call that already resolves the receipt.**~~ **Done - see `CHANGELOG.md`.** `server/services/receiptDataService.ts`'s `resolveInvoiceUrl`/`buildBidderReceiptWithInvoice`/`buildAllBidderReceiptsWithInvoices` now own the full get-or-create logic (reuse/cancel-and-recreate/create-new), writing Bidder-Numbers' J/K back themselves. `Class_ReceiptManager.gs`'s `getOrCreateInvoiceUrl`/`getPaymentLink`/`calculateAdjustedTotalWithFees` are gone - it's purely Doc-writing now, consuming `receipt.paymentUrl`/`receipt.adjustedTotal` (carried by `Receipt.fromData`). Along the way, found and fixed a real production bug: `Class_GoogleAIStudio.gs`'s `apiCreateAllReceipts`/`apiCreateIndividualReceipt` bridge functions were silently dropping the `receipts`/`receiptData` parameter Node always sends (declared with fewer parameters than Node calls them with) - every real receipt-generation call was already failing before this fix.

   - [x] ~~**Step 3 - Move `Class_GoogleAIStudio.gs`'s `recordPayment` (checkout mark-paid) into Node.**~~ **Done - see `CHANGELOG.md`.** `server/services/auctionService.ts`'s `checkoutMarkPaid` no longer bridges to Apps Script at all for payment recording - it reads/writes `Bidder-Numbers` itself and calls the Step 1 PayPal client directly (`recordOfflinePayment` for cash/check, `getInvoiceStatus` for the live credit-card gate). `Class_GoogleAIStudio.gs`'s `recordPayment`/`apiRecordPayment` are deleted.

   **Step 4 - Give `PayPalSweeper.gs`'s `checkPendingPayPalInvoices` a Node-side home. Different in kind from Steps 1-3, not "data Node should be handling on request" - it's a standing background service with no request to attach to.**
     1. Confirmed this app is a genuinely persistent process, not serverless/on-demand: `server/boot.ts` calls `app.listen(...)`. A Node scheduler (e.g. `node-cron`) is viable here with no infrastructure change needed.
     2. Add the scheduled job (e.g. `server/services/paypalSweeperJob.ts`), porting `checkPendingPayPalInvoices`'s logic: scan `Bidder-Numbers` for the `"PayPal Verification Pending"` marker, poll `getInvoiceStatus` (Step 1's client), resolve or escalate to `Follow-Up` on the same 10-minute timeout.
     3. Delete `PayPalSweeper.gs` and its GAS time-driven trigger once the Node job is confirmed running reliably.

   **Step 5 - Revisit `Class_EmailManager.gs` + `Class_Email.gs` once Steps 1-3 land.** These currently duplicate `emailService.ts`'s email-receipt feature entirely via a *different* code path (`GmailApp.sendEmail`, triggered when `createIndividualReceipt`'s `emailReceipt` flag is true) than the Node `/email-only`/`/email-all` routes' `processEmail`/`gmail.users.messages.send` - confirmed these currently render **visibly different HTML templates** for what a bidder would reasonably expect to be the same "email my receipt" feature. With PayPal/checkout fully in Node, decide whether `createIndividualReceipt`/`processBatch_`'s `emailReceipt` flag should keep sending its own GAS email at all, or be retired in favor of always routing through the already-correct Node `/email-only` path - this closes the product-consistency gap as a side effect rather than as separate work.

   **Not candidates - confirmed genuinely GAS-native, should stay put:**

   - `Class_DocService.gs`, `Class_DriveService.gs`, `Class_ReceiptDoc.gs` - real `DocumentApp`/`DriveApp` document generation (headers, inline images, QR codes, PDF conversion). Technically reachable from Node via the Docs/Drive REST APIs, but this is document-rendering logic tightly coupled to the Docs object model, not "pure data/sync logic" - a materially bigger, separate lift if ever attempted, not part of this item.
   - `Class_UIManager.gs`, `Class_UIStrings.gs`, `menu.gs` - spreadsheet-native UI (`SpreadsheetApp.getUi()`); `menu.gs`'s custom menu is already disabled/inert per an earlier hardening pass.
   - `Class_GlobalStyles.gs` - shared font/color constants consumed only by the Doc/email generators above; moot once/if those move, irrelevant otherwise.
   - `Class_AuctionItemManager.gs` - already fixed to read live from the Items spreadsheet rather than a local copy (see `CHANGELOG.md`); not a "move to Node" candidate since its only caller, `Class_ReceiptManager.gs`, is itself Doc-generation-coupled.
   - `Class_BidderManager.gs` - already a cross-spreadsheet-read success story from an earlier hardening pass (see `CHANGELOG.md`); its former `getSortedBidderData_`/`sortByLastName_` (the only reason it was ever relevant to receipts) are gone too - Node sorts bidders itself before calling `createAllReceipts` now (see `CHANGELOG.md`'s Code Hardening item #2 entry).

3. **Auction Items (Items) spreadsheet's GAS - same pass, notably different result.** Checked every `.gs` file in `scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/` (17 files, ~2,130 lines) for the same "pure data/sync logic with no genuine dependency on Apps Script" pattern as item #2. Unlike Bid Management, **this project has no checkout/payment/sync bridge logic and no live duplication/drift risk** - `Class_GoogleAIStudio.gs` (the API bridge Node calls) exposes exactly eight functions, and every single one of them exists purely to trigger a Doc/Slides generator (`createBundlingDoc`, `createItemLabels`, `createSlideshow`, `createBiddingGuideCoverPage`/`createBiddingGuideInnerPages`, `createBidSheets`, `createCatalog`, `createTableTents`, feeding `BundlingMeetingDoc`/`PackagingLabelsDoc`/`LiveAuctionSlides`/`BiddingGuideDoc`/`BidSheetDoc`/`CatalogDoc`/`TableTentDoc` respectively).

   - Checked specifically for the kind of already-existing duplication found in item #2 (a real, live divergence risk) and **found none of comparable severity**: the Doc generators (`BidSheetDoc.gs`, `CatalogDoc.gs`, `BiddingGuideDoc.gs`) only print `item.value`/`item.openingBid`/`item.category` literally - they don't recompute anything Node also computes. Node's `src/lib/categoryHelpers.ts`'s `getCategoryBase()` (used only to assign new item ID number ranges in the item-entry app) has no GAS counterpart at all - the Doc generators never reassign IDs, so this isn't a duplicate. `Class_BundlingMeetingDoc.gs` only prints a blank hand-annotation table for the bundling team's in-person meeting - it doesn't perform any bundling itself, so it doesn't overlap with `server/services/bundleService.ts`'s real bundling/resequencing logic. The one minor, low-stakes overlap: `Class_AuctionItem.gs`'s row-to-object field mapping (12-column positional schema: id/category/name/description/value/openingBid/minRaise/donatedBy/phyOrCert/status/bundleID/bundleTimeStamp) is the same schema `src/lib/itemParsing.ts`'s `parseItemRows` already encodes in TypeScript - not a computation that could silently diverge (it's a straightforward positional map, not a formula), but the same shape is defined in two languages if either sheet's column order ever changes.
   - `menu.gs` is already disabled/inert, matching the same policy applied to Bid Management's and Tickets' menus.

   **Where this differs from Bid Management/Tickets, and why it's still worth doing.** `Class_AuctionItemManager.gs`'s `getValidSortedItems()` (filters out `inactive`/`deleted` status, sorts numerically by ID) and `Class_AuctionItem.gs` (a plain row-to-object data model) are, in isolation, pure logic - but every Doc/Slides generator still calls `this.itemManager.getValidSortedItems()` and reads the Items sheet **itself**, inside GAS, rather than receiving an already-resolved item list from Node the way Bid Management's receipts and Tickets' bidder labels now do. There's no bug or drift risk forcing this (see above), so it was originally left as "low priority, not worth doing on its own." Confirmed by the user: worth doing anyway, purely for architectural consistency, so every `.gs` project in this app follows the same "Node resolves data, GAS only turns it into an artifact" shape with no exceptions.

   1. **Add a Node-side resolver matching `getValidSortedItems()` exactly.** New function (e.g. `server/services/itemDataService.ts`'s `getValidSortedItems(client, spreadsheetId)`) reading `'Auction-Items'!A:L` (reuse `server/services/itemService.ts`'s existing read/parsing rather than duplicating it) - filter out `status` `inactive`/`deleted` case-insensitively, sort ascending numerically by ID. Add test coverage before anything downstream depends on it.
   2. **Thread the resolved list through all 8 production routes.** `server/routes/productionRoutes.ts`'s `/item-entry/*` routes (`bundling-doc`, `item-labels`, `slideshow`, `bidding-guide-cover`, `bidding-guide-inner`, `bid-sheets`, `catalog`, `table-tents`) currently take only `folderId` - none accept a `spreadsheetId` at all yet (the same pre-existing gap already found and closed for receipts and bidder labels). Add `spreadsheetId` to each request body, call Step 1's resolver, and forward the resulting `items` array as a new parameter alongside `folderId` to each `apiCreate*` bridge call. Update `src/components/DocumentCreationTab.tsx` (the client caller of all 8) to send `config.auctionItemsSpreadsheetId`.
   3. **Add `AuctionItem.fromData()` on the GAS side**, mirroring `Class_ReceiptManager.gs`'s `Receipt.fromData()` precedent (see `CHANGELOG.md`'s Code Hardening item #2 entry) - reconstructs a real `AuctionItem` instance (so `isLive()`/`hasOpeningBid()`/`getDisplayValue()`/etc. keep working) from the plain object Node sends, instead of `Class_AuctionItem.gs`'s constructor parsing a raw spreadsheet row.
   4. **Update `Class_GoogleAIStudio.gs`'s 8 bridge functions and every Doc generator to consume the passed-in list directly.** Each `apiCreate*`/`create*` method accepts `items` as a new parameter and maps it via `items.map(AuctionItem.fromData)` before constructing its Doc generator, instead of passing the shared, lazily-constructed `this.itemManager`. Each Doc generator's constructor changes from `(fileName, itemManager, folderID)` to `(fileName, items, folderID)`, replacing every `this.itemManager.getValidSortedItems()` call with `this.items` directly - confirmed via grep as the full set needing this: `Class_BidSheetDoc.gs`, `Class_CatalogDoc.gs`, `Class_BiddingGuideDoc.gs`, `Class_PackagingLabelsDoc.gs`, `Class_TableTentDoc.gs`, `Class_LiveAuctionSlides.gs`, `Class_BundlingMeetingDoc.gs`.
   5. **Delete what's now dead**: `Class_AuctionItemManager.gs`'s `getValidSortedItems()`/`getAuctionItemAtIndex_`/`auctionItems` getter, and `Class_GoogleAIStudio.gs`'s lazy `itemManager` getter - confirm via grep that nothing else in the `.gs` tree still calls them before removing.
   6. **Full verification pass** per this repo's standard convention (`tsc --noEmit`, backend suite, frontend suite, `npm build`, mojibake check, sanity-check discipline on the resolver's filter/sort logic specifically), then a `CHANGELOG.md` entry and removing this item from this file, noting the reference-copy `.gs` files need manual re-copy into the live Items Apps Script editor.

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
