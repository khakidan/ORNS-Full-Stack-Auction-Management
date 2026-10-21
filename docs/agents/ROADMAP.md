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

Nothing outstanding - M1-M7 are all fixed (see `CHANGELOG.md`).

### Low

- **L8. Invoice for a bidder with no email** is addressed to `no-reply@example.com` (`resolveInvoiceUrl`, `receiptDataService.ts`), so PayPal tries to email a fake address. The likely fix is to create the invoice with no recipient email and send it with `send_to_recipient: false`, which still returns a payment link for the printed receipt. **Not done yet:** PayPal's docs don't say clearly whether an invoice can be created without a recipient email. Try it once in the PayPal sandbox first. If PayPal rejects it, no-email bidders' receipts would fail at checkout, which is worse than today.

L1-L7 and L9 are fixed (see `CHANGELOG.md`).

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
