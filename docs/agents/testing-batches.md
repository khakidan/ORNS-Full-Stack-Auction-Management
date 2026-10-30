# Running the Tests

**This is the only file that tracks current pass/fail totals.** `AGENTS.md` and `docs/agents/README.md` intentionally do not repeat these numbers - re-derive them here after every change instead of updating three files in lockstep.

(The file name is historical: the suite used to be run in two separate batches because a single run timed out in Google AI Studio's sandbox. Development no longer happens there, and the whole suite runs in one pass in about 20 seconds locally.)

---

## Run Everything

```bash
npm run test:quiet   # full suite, backend + frontend
npm run lint         # tsc --noEmit
```

`vitest.config.ts` starts every test worker with `--no-experimental-webstorage` (`execArgv`), which is required on Node 22+: Node's own built-in Web Storage global hides jsdom's `window.localStorage`, which the frontend tests need (`ConfigContext.tsx` reads it at module load). Because it's in the config, every way of running the tests gets it - the npm scripts, `npx vitest run <path>`, or an editor's test runner - with no `NODE_OPTIONS` needed.

Run both commands, and confirm the totals below, before declaring any task complete.

## On Every Pull Request (GitHub Actions)

`.github/workflows/test.yml` runs `npm ci`, `npm run lint` and `npm run test:quiet` on Node 24 for every pull request to `main` and every push to `main`. Branch protection on `main` requires its `test` check, so a PR whose type check or tests fail can't be merged - and so can't deploy (the Cloud Build deploy trigger is separate and unchanged). Still run both commands locally first; the check is the backstop, not the loop.

## Coverage

```bash
npm run test:coverage   # the whole suite, with a coverage summary; full report in coverage/index.html
```

There is no coverage threshold. Record the four totals in the table below when they move; a drop on a change that adds code means the new code went untested.

## Mutation Testing

```bash
npm run test:mutation   # Stryker on the money paths, about 4 minutes; report in reports/mutation/index.html
```

`stryker.config.json` lists the files: `financeUtils`, `winningBidChecks`, `ticketPaymentCheck`, `ticketPurchaseRow` and `bidderService`. It isn't run in CI. Run it after changing one of those files, and once before the auction. A surviving mutant is a change to the code that no test notices: add the test, or note why it can't matter (an equivalent mutant). First run (2026-10-29): 78.6%, survivors listed as ROADMAP T15-T18.

## Recorded Snapshots

`server/test/__snapshots__/` holds golden masters that pin every Sheets and PayPal call on the money paths (`moneyPaths.recorded`, `checkoutMarkPaid.recorded`, `syncService`). **Never update them with `vitest -u` without reading the diff.** Each changed line is a changed write to a spreadsheet or to PayPal: confirm it is the change you meant, and name it in the commit message ("snapshot: Mark Paid now also writes column N"). If you can't say why a line changed, the code is wrong, not the snapshot.

## Run One Layer

Useful for a faster loop, or to get the per-layer counts for the table below:

```bash
npx vitest run server/test/   # backend
npx vitest run src/           # frontend
```

- **Backend** (`server/test/`): Vitest + supertest + MSW route, service, and middleware tests, including the concurrency (`withLock`) and idempotency guards on every mutating write path, the PayPal invoice/checkout/sweeper logic, and (via a Node `vm` harness loading the real `.gs` source) the Apps Script classes. Route tests sign in with a real signed `orns_session` cookie from `server/test/helpers/session.ts`.
- **Frontend** (`src/`): React Testing Library + Vitest component, hook, and `src/lib/` tests.

---

## Current Totals

| Layer | Path | Tests |
|---|---|---|
| **Backend** | `server/test/` | **1118 passed** |
| **Frontend** | `src/` | **893 passed** |
| **Total** | `npm run test:quiet` | **2011 passed** |

| Coverage (`npm run test:coverage`, 2026-10-29) | |
|---|---|
| Lines | 93.79% |
| Branches | 81.65% |
| Functions | 88.47% |
| Statements | 91.74% |
