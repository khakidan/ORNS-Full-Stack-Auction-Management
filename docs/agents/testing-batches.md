# Sandbox-Safe Testing & Batches Guide

This document details the exact execution parameters required to run the test suite safely inside the AI Studio sandboxed development container.

**This is the only file that tracks current pass/fail totals.** `AGENTS.md` and `docs/agents/README.md` intentionally do not repeat these numbers - re-derive them here after every change instead of updating three files in lockstep.

---

## The Sandbox Constraint

Running the full test suite (997 tests) as a single execution block will exceed memory limits and trigger a **command timeout** in AI Studio's sandbox. 

To prevent execution freezes and ensure continuous status verification, the test suite is strictly partitioned into two operational batches.

---

## Execution Guide

### Batch 1: Backend Layer
Contains 484 integration and unit tests validating route pathways, middleware hooks, crypto managers, Sheets mocking configurations, and concurrency-safety guards on every bidder-mutating write path (`registerWalkInBidder`/`recordWinningBid`/`checkoutMarkPaid`/`checkInBidderWithBid`, all serialized per Bid-Management spreadsheet via `withLock`), every Auction-Items-mutating write path (`itemService.ts`'s `addItem`/`deleteItem`/`updateItem`/`bulkUpdateItems` and `bundleService.ts`'s `processBundle`/`restoreBundle`, all serialized per Items spreadsheet via a separate `auction-items:${spreadsheetId}` `withLock` key), and `settings/update` (serialized via its own `settings:${spreadsheetId}` key) - plus `record-winning-bid`'s numeric `price` validation and the `delete-item`/`settings/update` idempotency-key coverage; (via a Node `vm`-based harness loading the real source) the Tickets spreadsheet's bidder-number lookup/label generation, the Items spreadsheet's `AuctionItem`/`AuctionItem.fromData` and `GoogleAIStudio._executeGeneration`, and the still-live `Class_PayPalService.gs`/`PayPalSweeper.gs` reference copies (kept alongside their Node ports below until Step 4's manual production confirmation - see refactor-opportunities.md); the Node-side `itemDataService.ts` port of the Items spreadsheet's valid/sorted item resolution; the Node-side `paypalService.ts` port of the PayPal client (sandbox/production base-URL selection, invoice creation/cancellation, offline payment recording, live status lookup); `receiptDataService.ts`'s PayPal invoice get-or-create logic (reuse/cancel-and-recreate/create-new, ported from `Class_ReceiptManager.gs`'s now-removed `getOrCreateInvoiceUrl`); `auctionService.ts`'s `checkoutMarkPaid` payment-recording logic (cash/check/credit_card branches, the live PayPal-invoice-status gate, and its deferred-to-sweeper path), ported from `Class_GoogleAIStudio.gs`'s now-removed `recordPayment`/`apiRecordPayment`; `paypalSweeperJob.ts`'s background reconciliation sweep (resolve/escalate/timestamp-seed branches, per-row error resilience, and the sandbox-flag passthrough), ported from `PayPalSweeper.gs`'s `checkPendingPayPalInvoices`; and `paypalSweeperJob.ts`'s `getSweeperStatus`/the `GET /paypal-sweeper/status` and `POST /paypal-sweeper/run-now` routes backing the Configuration page's sweeper status card.

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run server/test/
```

### Batch 2: Frontend Layer
Contains 513 interactive components and state tests confirming layout flows, search inputs, modal triggers, dynamic calculations, the Settings page's PayPal sandbox/production toggle (including its link to the PayPal sandbox/business dashboard), `ConfigContext.tsx`'s Firestore snapshot merge dropping any field no longer in `Config`, `ErrorBoundary.tsx`'s top-level render-error catch (rendering the fallback UI, recording into `errorBuffer.ts`'s ring buffer, and reloading on demand), `usePaypalSweeperStatus.ts`/`PayPalSweeperStatusCard.tsx`'s PayPal sweeper status card (credential/last-run reporting, polling, and the manual "Run Sweep Now" trigger), `BugReportsAdmin.tsx`'s fixed-width, wrapping table columns (a long Title/Route can no longer push the Actions column's buttons out of view), `BidEntry.tsx`'s empty-field item/bidder label guard plus its field label/input spacing, `Items.tsx`'s numeric-by-item-number sort of the Auction Catalog table, the redesigned Bidders tab (`BiddersList.tsx`/`BidderRow.tsx`'s Attendee-List-style flexible rows, plus `BiddersFilterControls.tsx`'s "Sort by" select actually re-sorting the visible rows), `FilterToolbar.tsx`'s `filtersWrap` prop keeping Bidders' 4-filter row on one line instead of wrapping, the redesigned Items tab (`ItemsList.tsx`/`ItemRow.tsx`'s Attendee-List-style flexible rows surfacing description/value/donor/bundle-status fields the old table never showed, plus hashed-per-category and fixed-per-itemType badge colors via the shared `src/lib/itemBadgeColors.ts`), the redesigned Auction Items Database (`AuctionItemsList.tsx`/`AuctionItemRow.tsx`'s flexible rows with selection/edit/delete/bundle-restore, `EditAuctionItemDialog.tsx` consolidating 9 per-field inline editors into one dialog-based save with a real category-last write-ordering guard, and `AuctionItemsFilterControls.tsx`'s 12-option "Sort by" select now rendered via the shared `FilterToolbar.tsx`, matching the other three redesigned pages' search/filter placement), the shared `ListPageCard.tsx` Card/CardHeader/CardContent shell now used by all four search-and-list pages, and the fixed double-gap whitespace bugs on `TicketAttendeeTab.tsx`'s Attendee List header and (before the filter bar's move out of the `Card` made the issue moot) `AuctionItemsFilterBar.tsx`'s root padding.

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/
```

The `NODE_OPTIONS` flag is required (not optional) for Batch 2 on Node 22+: `ConfigContext.tsx` reads the bare `localStorage` global at module-load time, and Node's own built-in Web Storage global can leave jsdom's `window.localStorage` unavailable in this sandbox's test environment unless that experimental feature is disabled. Without it, `ConfigContext.test.tsx` fails outright with `TypeError: Cannot read properties of undefined (reading 'getItem')`. For Batch 1 the same flag is optional - the backend suite never touches `localStorage` - but it's included above to silence Node's cosmetic `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided` notice, which is otherwise harmless noise unrelated to test results.

---

## Verifying Combined Totals

Always execute both batches and confirm the final aggregates prior to declaring any task complete:

| Batch Name | Path Parameter | Target Tests Count |
|---|---|---|
| **Batch 1 (Backend)** | `server/test/` | **484 passed** |
| **Batch 2 (Frontend)** | `src/` | **513 passed** |
| **Combined Aggregate** | *All Test Files* | **997 passed** |

*Do not run a bare `npx vitest run` without specifying these directory boundaries.*
