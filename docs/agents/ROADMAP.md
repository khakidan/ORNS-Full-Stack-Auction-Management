# Project Roadmap & Structural Blueprint

This document holds the **ORNS Charity Auction Manager**'s outstanding work: the verified bug/security/hardening backlog from the most recent code audit, followed by net-new feature milestones. When a backlog item is finished, remove it from this file entirely and record what happened in [`CHANGELOG.md`](./CHANGELOG.md) - this file only ever shows what's still outstanding, never a history of what's already done.

(The backlog used to live in `refactor-opportunities.md`; that file had gone stale - it reported Code Hardening as "fully closed" and its "Passed Audit Inspection" list cited files that no longer exist - so it was cleared on 2026-10-21 and this audit's findings were logged here instead.)

---

## ⚠️ DO THIS BEFORE THE AUCTION

**Test the cash/check surcharge removal against real PayPal (sandbox mode) at least once.** It's covered by unit tests that simulate PayPal's API, but has never been exercised against PayPal itself (see `CHANGELOG.md`'s L3 entry, `PayPalService.removeSurchargeLine` in `server/services/paypalService.ts`).

Steps:

1. Confirm the app is in PayPal sandbox mode (Config's `paypalIsSandbox`, or check the PayPal Integration card in Configuration).
2. Pick a test bidder who's won at least one item but hasn't checked out.
3. Print or email that bidder's receipt first, so a PayPal invoice exists for them (Checkout page, or Bidders page).
4. Log into the PayPal sandbox dashboard and find that invoice; note its total (it should include the processing fee).
5. In the app's Checkout page, mark that bidder paid with **Cash** (or **Check**).
6. If a yellow warning toast appears, the fee removal didn't go through cleanly - read what it says (it tells you what to do, e.g. mark the invoice paid by hand in PayPal) and note the wording so it can be looked into.
7. If no warning appears, refresh the invoice in the PayPal sandbox dashboard and confirm:
   - The processing-fee line item is gone.
   - The invoice total is now just the sum of the bidder's winning bids (no fee).
   - The invoice shows as **Paid**.
8. Once this works, remove this item and note the result in `CHANGELOG.md`.

If step 7 doesn't check out, cash/check checkouts will still work (the code falls back to recording the full fee-inclusive amount if the removal call fails) - but the bidder's invoice will keep showing the fee amount even though cash was collected without it. In that case let the dev know what happened in step 6/7 instead of using this feature for real auction checkouts yet.

**Test the saved-bids outbox (Milestone A) in a real browser at least once.** It's covered by unit tests, but has never run in a real browser with a real connection drop.

Steps:

1. On a laptop, open the app, sign in, and go to **Bid Management -> Bid Entry**. Use test items and bidders, or a copy of the spreadsheets.
2. Turn the laptop's Wi-Fi off. The banner should say **No internet connection**.
3. Record 3 winning bids. Each should show **Saved on this device** in This Session, and the sidebar should say **3 bids waiting**.
4. Reload the page while still offline. Click through the "Leave site?" warning. The banner should still count 3 saved bids.
5. Turn the Wi-Fi back on. Within a few seconds the banner should say **Sending saved bids**, then **All saved bids sent**.
6. Open the Bid-Management sheet and check each of the 3 bids appears **exactly once**.
7. Once this works, remove this item and note the result in `CHANGELOG.md`. When both items are done, remove this whole section.

If a bid is missing or appears twice, don't rely on the outbox at the auction: if the Wi-Fi drops, write bids on paper and enter them once it's back. Tell the dev what you saw.

---

## 2026-10-21 Code Audit Backlog

Full read of `server/**` (~6K lines), `firestore.rules`, and the client auth/API layer (`src/services/google-api.ts`, `src/hooks/useApiAuthStatus.ts`, `src/context/ConfigContext.tsx`), measured against the docs under `docs/agents/`. Every item below was confirmed by direct read of the cited code unless marked **(plausible - not reproduced)**. At audit time the suite was green (505 backend / 646 frontend) and `tsc --noEmit` was clean - none of these are caught by the existing tests.

Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

### High - money path / data integrity

Nothing outstanding - H1-H7 are all fixed (see `CHANGELOG.md`).

### Medium - security hardening / operational

Nothing outstanding - M1-M7 are all fixed (see `CHANGELOG.md`).

### Low

Nothing outstanding - L1-L9 are all fixed (see `CHANGELOG.md`).

### Confirmed fine (don't "fix")

- The Firebase web `apiKey` in `firebase-applet-config.json` is a public client identifier by design, not a leaked secret.
- `firestore.rules` is tight: default-deny, `@orns.org` + `email_verified` gate, strict 17-key `Config` shape that matches `src/types.ts`'s `Config`.

---

## 2026-10-22 Refactor Audit Backlog

Whole-codebase read against `AGENTS.md` and every guide under `docs/agents/` (component-standards, patterns, performance, react-patterns, style_guide, tailwind-style-guide, testing-philosophy), at commit `b67bd17`. Each item was confirmed in the code. Item IDs are stable - refer to them by ID in commits and `CHANGELOG.md` entries.

### Before the auction - unlocked writes

Nothing outstanding - R1-R4 are fixed (see `CHANGELOG.md`).

### After the auction - structure

Nothing outstanding - R5-R11 are fixed (see `CHANGELOG.md`).

### Small cleanups

Nothing outstanding - R12-R20 are fixed (see `CHANGELOG.md`).

---

## Feature Milestones (Staging)

Nothing outstanding.
