# Project Roadmap & Structural Blueprint

This document holds the **ORNS Charity Auction Manager**'s outstanding work: the verified bug/security/hardening backlog from the most recent code audit, followed by net-new feature milestones. When a backlog item is finished, remove it from this file entirely and record what happened in [`CHANGELOG.md`](./CHANGELOG.md) - this file only ever shows what's still outstanding, never a history of what's already done.

(The backlog used to live in `refactor-opportunities.md`; that file had gone stale - it reported Code Hardening as "fully closed" and its "Passed Audit Inspection" list cited files that no longer exist - so it was cleared on 2026-10-21 and this audit's findings were logged here instead.)

---

## 2026-10-21 Code Audit Backlog

Full read of `server/**` (~6K lines), `firestore.rules`, and the client auth/API layer (`src/services/google-api.ts`, `src/hooks/useApiAuthStatus.ts`, `src/context/ConfigContext.tsx`), measured against the docs under `docs/agents/`. Every item below was confirmed by direct read of the cited code unless marked **(plausible - not reproduced)**. At audit time the suite was green (505 backend / 646 frontend) and `tsc --noEmit` was clean - none of these are caught by the existing tests.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

### High - money path / data integrity

Nothing outstanding - H1-H7 are all fixed (see `CHANGELOG.md`).

### Medium - security hardening / operational

M1, M2, M3, M5, M6 and M7 are fixed (see `CHANGELOG.md`).

- **M4. Single-instance assumptions need Cloud Run settings to match.** `withLock`, the idempotency map, `sheetCache`, the bug-report rate limit, the PayPal-mode cache, and the `setInterval` sweeper are all in-process (`asyncLock.ts`'s own comment: "not horizontally scaled"). That requires the Cloud Run service to run with **maximum instances = 1**, and the sweeper also needs **CPU always allocated** (instance-based billing; CPU is throttled between requests otherwise). Both settings are now documented in `README.md`'s Deployment section, but they haven't been confirmed on the live service (`gcloud` wasn't signed in during the audit). Remove this item once they're confirmed.

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
