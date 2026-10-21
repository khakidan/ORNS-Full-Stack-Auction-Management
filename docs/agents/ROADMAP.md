# Project Roadmap & Structural Blueprint

This document holds the **ORNS Charity Auction Manager**'s outstanding work: the verified bug/security/hardening backlog from the most recent code audit, followed by net-new feature milestones. When a backlog item is finished, remove it from this file entirely and record what happened in [`CHANGELOG.md`](./CHANGELOG.md) - this file only ever shows what's still outstanding, never a history of what's already done.

(The backlog used to live in `refactor-opportunities.md`; that file had gone stale - it reported Code Hardening as "fully closed" and its "Passed Audit Inspection" list cited files that no longer exist - so it was cleared on 2026-10-21 and this audit's findings were logged here instead.)

---

## 2026-10-21 Code Audit Backlog

Full read of `server/**` (~6K lines), `firestore.rules`, and the client auth/API layer (`src/services/google-api.ts`, `src/hooks/useApiAuthStatus.ts`, `src/context/ConfigContext.tsx`), measured against the docs under `docs/agents/`. Every item below was confirmed by direct read of the cited code unless marked **(plausible - not reproduced)**. At audit time the suite was green (505 backend / 646 frontend) and `tsc --noEmit` was clean - none of these are caught by the existing tests.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

### High - money path / data integrity

- **H2. Emailed receipts can link to a stale or cancelled invoice.** `processEmail` (`server/services/emailService.ts`) uses whatever URL is cached in Column J, but computes the "Pay $X" button amount fresh from the current total. If the bidder won more items since the invoice was made, the link pays the old amount - or points at an invoice `resolveInvoiceUrl` has since cancelled. With no Column J value at all, it falls back to a bare `https://www.paypal.com` link. Should resolve the invoice via `resolveInvoiceUrl` (same as the receipt routes) before emailing.

- **H3. Email-all re-sends on retry, and email construction is unescaped.**
  - No per-bidder "emailed" marker exists, so a retried `/api/receipts/email-all` (`fetchWithRetry` in `src/services/google-api.ts` auto-retries any 5xx, POSTs included) re-emails every bidder. `processAllEmails` (`server/services/receiptService.ts`) also re-reads three full sheets per bidder, making Sheets quota 429s/timeouts - and therefore retries - likely at real auction scale.
  - `createRawEmail` interpolates sheet-sourced values straight into the `To:`/`Subject:` headers. A CR/LF in a sheet cell can inject extra headers (e.g. `Bcc:`), sending from the staff member's Gmail to an address nobody chose.
  - The subject isn't RFC 2047-encoded, so non-ASCII names ("José") arrive mangled.
  - `generateEmailHtml` interpolates names/item names/IDs and the payment URL into HTML without escaping.

- **H5. PayPal sweeper writes Bidder-Numbers without the bidder lock.** `runPaypalSweepInner` (`server/services/paypalSweeperJob.ts`) reads a snapshot, then writes G:I/L per row without `withLock('bidder-numbers:...')`. If staff mark a pending bidder as Cash mid-sweep, the sweeper can then overwrite that row with "Failed Verification - Follow Up Required".

- **H6. Idempotency doesn't stop concurrent duplicates.** `server/utils/idempotency.ts` checks for a key at request start but only saves it after the work succeeds, so a retry arriving while the first request is still in flight runs the full operation again - the exact case the key exists to prevent. Keys are also global (not scoped per route or per user), so the same key on two routes returns the wrong cached response. Track in-flight keys (store a pending promise) and namespace keys by route.

### Medium - security hardening / operational

- **M1. Unauthenticated endpoints.**
  - `POST /log` (`server/routes/authRoutes.ts`) pretty-prints up to 5 MB of arbitrary JSON from anyone into server logs (log flooding / Cloud Logging cost).
  - `POST /api/bug-reports/`'s local-file fallback writes up to 5 MB to disk per anonymous request. On Cloud Run the writable filesystem is in-memory (OOM risk) and is wiped on instance recycle, so `AGENTS.md`'s "a report is never silently lost" guarantee doesn't hold in production.
  - Spreadsheet formula injection on that same endpoint: `report.type`, `report.timestamp`, and the report ID (built from `timestamp`) skip `sanitizeForSheetFormula` in `appendBugReportToSheet` (`server/services/bugReportService.ts`).

- **M2. OAuth flow has no `state` parameter** (`server/routes/authRoutes.ts`'s `/auth/url` + `/auth/callback`), which allows login CSRF. The domain gate is also an email-suffix check only; checking the userinfo `hd` (Workspace domain) claim as well would be stricter.

- **M3. Client chooses PayPal sandbox vs. production.** `paypalIsSandbox` is read from the request body in `receiptRoutes.ts` and `bidRoutes.ts`'s checkout, but from Firestore `settings/global` in the sweeper. A browser with stale config can create invoices in one mode that the sweeper then checks in the other. Read it server-side from Firestore everywhere.

- **M4. Single-instance assumptions need Cloud Run settings to match.** `withLock`, the idempotency map, `sheetCache`, and the `setInterval` sweeper are all in-process (`asyncLock.ts`'s own comment: "not horizontally scaled"). That requires the Cloud Run service to run with max-instances = 1, and the sweeper also needs "CPU always allocated" (CPU is throttled between requests otherwise). Verify both on the live service and document them in `README.md`'s Deployment section.

- **M5. Google API client retries non-idempotent POSTs.** `server/services/google.ts` sets `httpMethodsToRetry` to include `POST`, so a transient 5xx after the server already applied the write can duplicate a `values.append` row (walk-ins, Follow-Up rows) or a Gmail send.

- **M6. Apps Script runs with `devMode: true` in production.** `productionRoutes.ts` and `receiptService.ts` call `scripts.run` with `devMode: true`, which executes whatever is currently *saved* in the script editor (not a versioned deployment) and requires every caller to have edit access to the script.

- **M7. Dependencies.** `npm audit --omit=dev` reports 34 vulnerabilities (2 critical: `proxy-addr` via `express`, `websocket-driver` via `firebase`). `nodemailer` (high severity), `express-session`, and `session-file-store` have no importers anywhere and can be removed; `msw` (test mocks) and `shadcn` (a CLI) belong in `devDependencies`.

### Low

- **L1. Hardcoded sheet names in the receipt/email paths.** `receiptDataService.ts`, `emailService.ts`, and `receiptService.ts` read/write `'Bidder-Numbers'`/`'Bid-Management'` literally instead of the configured `bidderNumbersSheet`/`bidManagementSheet` that checkout and the sweeper use.
- **L2. Paid-status mismatch.** Checkout's credit-card path (`auctionService.ts`) only treats `"PAID"` as paid; the sweeper also accepts `"MARKED_AS_PAID"`, so a marked-as-paid invoice is needlessly deferred at checkout.
- **L3. Cash/check ledger amount.** Checkout records the offline payment on PayPal at Column K's surcharge-inclusive total rather than the cash subtotal, and ignores `recordOfflinePayment`'s `false` return (failures are silent).
- **L4. Check-in result is optimistic.** `checkInBidderWithBid` (`bidderService.ts`) returns `checkedIn: true` even when the bidder isn't found in Bidder-Numbers; `bidValue` is never checked to be numeric (unlike `record-winning-bid`'s `price`).
- **L5. Shared sheet cache.** `dataRoutes.ts`'s GET `/sheets/:id/:range` serves `sheetCache` entries to any authenticated user without confirming that user can read the spreadsheet.
- **L6. Raw error messages to clients.** `errorHandler.ts` returns `err.message` (Google/PayPal API error text) in every 500 response.
- **L7. Drive query interpolation.** `dataRoutes.ts`'s `/drive/files/:folderId` interpolates `folderId` into the Drive `q` string unescaped.
- **L8. Invoice for a bidder with no email** is addressed to `no-reply@example.com` (`resolveInvoiceUrl`, `receiptDataService.ts`).
- **L9. No security headers** - no CSP and no `frame-ancestors` restriction. The app is no longer embedded anywhere (AI Studio's iframe is gone), so `frame-ancestors 'none'` / `X-Frame-Options: DENY` can be set outright.

### Confirmed fine (don't "fix")

- The Firebase web `apiKey` in `firebase-applet-config.json` is a public client identifier by design, not a leaked secret.
- `firestore.rules` is tight: default-deny, `@orns.org` + `email_verified` gate, strict 17-key `Config` shape that matches `src/types.ts`'s `Config`.

---

## Feature Milestones (Staging)

### Milestone A: Sync & Retry Resiliency

- Implement visual indicator banners within the frontend configuration header when Google Sheets syncing transactions are retrying in the background.
- Introduce client-side offline queues that buffer bid logs temporarily in local storage during brief network drops, then replay them with idempotency keys upon restoration.

### Milestone B: Advanced Reporting Dashboards

- Expand the analytics engine within `/src/components/Dashboard.tsx` to visualize bid distributions over time, total funds raised by category, and real-time checkout percentages via D3 charts.
