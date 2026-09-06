# Sandbox-Safe Testing & Batches Guide

This document details the exact execution parameters required to run the test suite safely inside the AI Studio sandboxed development container.

**This is the only file that tracks current pass/fail totals.** `AGENTS.md` and `docs/agents/README.md` intentionally do not repeat these numbers - re-derive them here after every change instead of updating three files in lockstep.

---

## The Sandbox Constraint

Running the full test suite (925 tests) as a single execution block will exceed memory limits and trigger a **command timeout** in AI Studio's sandbox. 

To prevent execution freezes and ensure continuous status verification, the test suite is strictly partitioned into two operational batches.

---

## Execution Guide

### Batch 1: Backend Layer
Contains 468 integration and unit tests validating route pathways, middleware hooks, crypto managers, Sheets mocking configurations; (via a Node `vm`-based harness loading the real source) the Tickets spreadsheet's bidder-number lookup/label generation, the Items spreadsheet's `AuctionItem`/`AuctionItem.fromData` and `GoogleAIStudio._executeGeneration`, and the still-live `Class_PayPalService.gs`/`PayPalSweeper.gs` reference copies (kept alongside their Node ports below until Step 4's manual production confirmation - see refactor-opportunities.md); the Node-side `itemDataService.ts` port of the Items spreadsheet's valid/sorted item resolution; the Node-side `paypalService.ts` port of the PayPal client (sandbox/production base-URL selection, invoice creation/cancellation, offline payment recording, live status lookup); `receiptDataService.ts`'s PayPal invoice get-or-create logic (reuse/cancel-and-recreate/create-new, ported from `Class_ReceiptManager.gs`'s now-removed `getOrCreateInvoiceUrl`); `auctionService.ts`'s `checkoutMarkPaid` payment-recording logic (cash/check/credit_card branches, the live PayPal-invoice-status gate, and its deferred-to-sweeper path), ported from `Class_GoogleAIStudio.gs`'s now-removed `recordPayment`/`apiRecordPayment`; and `paypalSweeperJob.ts`'s background reconciliation sweep (resolve/escalate/timestamp-seed branches, per-row error resilience, and the sandbox-flag passthrough), ported from `PayPalSweeper.gs`'s `checkPendingPayPalInvoices`.

```bash
npx vitest run server/test/
```

### Batch 2: Frontend Layer
Contains 457 interactive components and state tests confirming layout flows, search inputs, modal triggers, dynamic calculations, the Settings page's PayPal sandbox/production toggle (including its link to the PayPal sandbox/business dashboard), and `ConfigContext.tsx`'s Firestore snapshot merge dropping any field no longer in `Config`.

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/
```

The `NODE_OPTIONS` flag is required here (not optional) on Node 22+: `ConfigContext.tsx` reads the bare `localStorage` global at module-load time, and Node's own built-in Web Storage global can leave jsdom's `window.localStorage` unavailable in this sandbox's test environment unless that experimental feature is disabled. Without it, `ConfigContext.test.tsx` fails outright with `TypeError: Cannot read properties of undefined (reading 'getItem')`.

---

## Verifying Combined Totals

Always execute both batches and confirm the final aggregates prior to declaring any task complete:

| Batch Name | Path Parameter | Target Tests Count |
|---|---|---|
| **Batch 1 (Backend)** | `server/test/` | **468 passed** |
| **Batch 2 (Frontend)** | `src/` | **457 passed** |
| **Combined Aggregate** | *All Test Files* | **925 passed** |

*Do not run a bare `npx vitest run` without specifying these directory boundaries.*
