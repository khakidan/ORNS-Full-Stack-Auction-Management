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

   **Strong candidates (pure logic, already duplicated in Node - highest priority):**

   - **`Class_PayPalService.gs`** is a pure PayPal REST API HTTP client (`UrlFetchApp.fetch` calls only - no `SpreadsheetApp`/`DocumentApp`/`DriveApp` anywhere in the class): OAuth token exchange (`getAccessToken_`), `createAndSendInvoice`, `cancelInvoice`, `recordOfflinePayment`, `getInvoiceStatus`, `extractInvoiceIdFromUrl`, and `calculatePayPalSurcharge`. **This last method is byte-for-byte duplicated** with `server/utils/financeUtils.ts`'s `calculatePayPalSurcharge` - same percent rate (0.0349), same fixed fee ($0.49), same rounding - two independent implementations of the exact same fee math that could drift apart with one careless edit to either file. The rest of the class (invoice CRUD, offline-payment recording, live status polling) has **no Node equivalent yet** - `server/services/paypal.ts`-style Node code only calculates/display the fee today, it never talks to PayPal's API directly. Moving this whole class into a Node `paypalService.ts` (using `fetch` instead of `UrlFetchApp`, PayPal credentials as env vars instead of `PropertiesService` script properties) would consolidate the fee math into one place and let checkout/reconciliation logic call PayPal directly from Node instead of bridging through Apps Script.
   - **`Class_GoogleAIStudio.gs`'s `recordPayment`** (bridged via `apiRecordPayment`, called by `server/services/auctionService.ts`'s `checkoutMarkPaid` today): pure `Bidder-Numbers` sheet read/write (checked-out/paid columns, invoice URL/amount columns) plus calls into `PayPalService`. Nothing here needs Apps Script - it's already effectively "Node calls into GAS to do a sheet write Node could do itself" once `PayPalService` is ported per above.
   - ~~`Class_ReceiptManager.gs`'s pure-data methods~~ **Partially done - see `CHANGELOG.md`.** `findBidderColInBidSheet_`, `getEmailForBidder_`, and `buildReceipt_` (the item/total-resolution logic that used to duplicate `server/services/emailService.ts`'s `processEmail`) are gone; Node now resolves a bidder's winning items/total itself (`server/services/receiptDataService.ts`, also now shared by `processEmail`) and hands the finished data into `apiCreateIndividualReceipt`/`apiCreateAllReceipts` as a parameter, the same pattern used for bidder labels. **Still pending, deliberately left in GAS:** `getPaymentLink`/`getOrCreateInvoiceUrl` (PayPal invoice creation - a real financial side effect) and `calculateAdjustedTotalWithFees` (calls `PayPalService.calculatePayPalSurcharge`, still duplicated with `financeUtils.ts`'s copy per the `Class_PayPalService.gs` bullet above). Moving these depends on that same bullet - porting `PayPalService`'s invoice CRUD to Node with its own credentials as env vars - not this one.
   - **`Class_EmailManager.gs` + `Class_Email.gs`** duplicate `emailService.ts`'s email-receipt feature entirely, via a *different* code path (`GmailApp.sendEmail` from GAS, triggered when `createIndividualReceipt`'s `emailReceipt` flag is true) than the Node `/email-only`/`/email-all` routes' `processEmail`/`gmail.users.messages.send`. Confirmed these render **visibly different HTML templates** for what a bidder would reasonably expect to be the same "email my receipt" feature - worth flagging as a product-consistency issue on top of the code duplication: a bidder emailed via one path sees a different-looking receipt than one emailed via the other.

   **Moderate candidate (pure logic, but needs new Node infrastructure to migrate):**

   - **`PayPalSweeper.gs`'s `checkPendingPayPalInvoices`** - pure `Bidder-Numbers`/`Follow-Up` sheet read/write plus `PayPalService` calls, no Docs/Drive/UI dependency at all. The only genuinely GAS-specific piece is *how it runs*: a time-driven Apps Script trigger, which executes on Google's infrastructure under the spreadsheet owner's own account at zero extra hosting cost. Porting this to Node is only worth it if the app already has (or the team is willing to stand up) a persistent, always-on Node process with its own scheduler (e.g. `node-cron`) - otherwise this is the strongest argument for keeping *something* in GAS, per the earlier discussion in this conversation about not doing a wholesale migration.

   **Not candidates - confirmed genuinely GAS-native, should stay put:**

   - `Class_DocService.gs`, `Class_DriveService.gs`, `Class_ReceiptDoc.gs` - real `DocumentApp`/`DriveApp` document generation (headers, inline images, QR codes, PDF conversion). Technically reachable from Node via the Docs/Drive REST APIs, but this is document-rendering logic tightly coupled to the Docs object model, not "pure data/sync logic" - a materially bigger, separate lift if ever attempted, not part of this item.
   - `Class_UIManager.gs`, `Class_UIStrings.gs`, `menu.gs` - spreadsheet-native UI (`SpreadsheetApp.getUi()`); `menu.gs`'s custom menu is already disabled/inert per an earlier hardening pass.
   - `Class_GlobalStyles.gs` - shared font/color constants consumed only by the Doc/email generators above; moot once/if those move, irrelevant otherwise.
   - `Class_AuctionItemManager.gs` - already fixed to read live from the Items spreadsheet rather than a local copy (see `CHANGELOG.md`); not a "move to Node" candidate since its only caller, `Class_ReceiptManager.gs`, is itself Doc-generation-coupled.
   - `Class_BidderManager.gs` - already a cross-spreadsheet-read success story from an earlier hardening pass (see `CHANGELOG.md`); its `getSortedBidderData_` is called by `Class_GoogleAIStudio.gs`'s `createAllReceipts`, which is itself Doc-generation-coupled, so it stays alongside that.

3. **Auction Items (Items) spreadsheet's GAS - same pass, notably different result.** Checked every `.gs` file in `scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/` (17 files, ~2,130 lines) for the same "pure data/sync logic with no genuine dependency on Apps Script" pattern as item #2. Unlike Bid Management, **this project turned out to be a poor migration candidate almost across the board** - it has no checkout/payment/sync bridge logic at all; `Class_GoogleAIStudio.gs` (the API bridge Node calls) exposes exactly eight functions, and every single one of them exists purely to trigger a Doc/Slides generator (`createBundlingDoc`, `createItemLabels`, `createSlideshow`, `createBiddingGuideCoverPage`/`createBiddingGuideInnerPages`, `createBidSheets`, `createCatalog`, `createTableTents`, feeding `BundlingMeetingDoc`/`PackagingLabelsDoc`/`LiveAuctionSlides`/`BiddingGuideDoc`/`BidSheetDoc`/`CatalogDoc`/`TableTentDoc` respectively). This spreadsheet's whole GAS project is a print/slide-generation pipeline, full stop.

   - **`Class_AuctionItemManager.gs`'s `getValidSortedItems()`** (filters out `inactive`/`deleted` status, sorts numerically by ID) and **`Class_AuctionItem.gs`** (a plain row-to-object data model, zero Apps Script API calls at all) are, in isolation, pure logic - but their *only* consumers are the Doc/Slides generators listed above, which themselves must stay in GAS. Moving just the data-fetching piece to Node wouldn't remove any GAS dependency here, unlike Bid Management's `PayPalService`/`ReceiptManager` case where Node already independently needed the same computation for a Node-side consumer (the email-receipt path). Low priority to migrate on its own.
   - Checked specifically for the kind of already-existing duplication found in item #2 (a real, live divergence risk) and **found none of comparable severity**: the Doc generators (`BidSheetDoc.gs`, `CatalogDoc.gs`, `BiddingGuideDoc.gs`) only print `item.value`/`item.openingBid`/`item.category` literally - they don't recompute anything Node also computes. Node's `src/lib/categoryHelpers.ts`'s `getCategoryBase()` (used only to assign new item ID number ranges in the item-entry app) has no GAS counterpart at all - the Doc generators never reassign IDs, so this isn't a duplicate. `Class_BundlingMeetingDoc.gs` only prints a blank hand-annotation table for the bundling team's in-person meeting - it doesn't perform any bundling itself, so it doesn't overlap with `server/services/bundleService.ts`'s real bundling/resequencing logic. The one minor, low-stakes overlap: `Class_AuctionItem.gs`'s row-to-object field mapping (12-column positional schema: id/category/name/description/value/openingBid/minRaise/donatedBy/phyOrCert/status/bundleID/bundleTimeStamp) is the same schema `src/lib/itemParsing.ts`'s `parseItemRows` already encodes in TypeScript - not a computation that could silently diverge (it's a straightforward positional map, not a formula), but the same shape is defined in two languages if either sheet's column order ever changes.
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
