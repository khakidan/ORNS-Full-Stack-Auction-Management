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
| **Backend** | `server/test/` | **958 passed** |
| **Frontend** | `src/` | **814 passed** |
| **Total** | `npm run test:quiet` | **1772 passed** |
