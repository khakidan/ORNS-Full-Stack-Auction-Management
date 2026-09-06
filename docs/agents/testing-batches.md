# Sandbox-Safe Testing & Batches Guide

This document details the exact execution parameters required to run the test suite safely inside the AI Studio sandboxed development container.

**This is the only file that tracks current pass/fail totals.** `AGENTS.md` and `docs/agents/README.md` intentionally do not repeat these numbers - re-derive them here after every change instead of updating three files in lockstep.

---

## The Sandbox Constraint

Running the full test suite (859 tests) as a single execution block will exceed memory limits and trigger a **command timeout** in AI Studio's sandbox. 

To prevent execution freezes and ensure continuous status verification, the test suite is strictly partitioned into two operational batches.

---

## Execution Guide

### Batch 1: Backend Layer
Contains 409 integration and unit tests validating route pathways, middleware hooks, crypto managers, Sheets mocking configurations, and (via a Node `vm`-based harness loading the real source) the Google Apps Script reference copy's PayPal service, checkout bridge, background reconciliation sweeper, item data layer, and the Tickets spreadsheet's bidder-number lookup/label generation.

```bash
npx vitest run server/test/
```

### Batch 2: Frontend Layer
Contains 450 interactive components and state tests confirming layout flows, search inputs, modal triggers, and dynamic calculations.

```bash
NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/
```

The `NODE_OPTIONS` flag is required here (not optional) on Node 22+: `ConfigContext.tsx` reads the bare `localStorage` global at module-load time, and Node's own built-in Web Storage global can leave jsdom's `window.localStorage` unavailable in this sandbox's test environment unless that experimental feature is disabled. Without it, `ConfigContext.test.tsx` fails outright with `TypeError: Cannot read properties of undefined (reading 'getItem')`.

---

## Verifying Combined Totals

Always execute both batches and confirm the final aggregates prior to declaring any task complete:

| Batch Name | Path Parameter | Target Tests Count |
|---|---|---|
| **Batch 1 (Backend)** | `server/test/` | **409 passed** |
| **Batch 2 (Frontend)** | `src/` | **450 passed** |
| **Combined Aggregate** | *All Test Files* | **859 passed** |

*Do not run a bare `npx vitest run` without specifying these directory boundaries.*
