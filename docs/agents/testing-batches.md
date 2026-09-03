# Sandbox-Safe Testing & Batches Guide

This document details the exact execution parameters required to run the test suite safely inside the AI Studio sandboxed development container.

---

## The Sandbox Constraint

Running the full test suite (387 tests) as a single execution block will exceed memory limits and trigger a **command timeout** in AI Studio's sandbox. 

To prevent execution freezes and ensure continuous status verification, the test suite is strictly partitioned into two operational batches.

---

## Execution Guide

### Batch 1: Backend Layer
Contains 275 integration and unit tests validating route pathways, middleware hooks, crypto managers, Sheets mocking configurations, and (via a Node `vm`-based harness loading the real source) the Google Apps Script reference copy's PayPal service, checkout bridge, and background reconciliation sweeper.

```bash
npx vitest run server/test/
```

### Batch 2: Frontend Layer
Contains 112 interactive components and state tests confirming layout flows, search inputs, modal triggers, and dynamic calculations.

```bash
npx vitest run src/
```

---

## Verifying Combined Totals

Always execute both batches and confirm the final aggregates prior to declaring any task complete:

| Batch Name | Path Parameter | Target Tests Count |
|---|---|---|
| **Batch 1 (Backend)** | `server/test/` | **275 passed** |
| **Batch 2 (Frontend)** | `src/` | **112 passed** |
| **Combined Aggregate** | *All Test Files* | **387 passed** |

*Do not run a bare `npx vitest run` without specifying these directory boundaries.*
