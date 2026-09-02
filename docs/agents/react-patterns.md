# React Patterns & Architecture

> **Status: written for this codebase's actual current state**, verified
> against `src/` on 2026-09-02. [`patterns.md`](./patterns.md) is
> authoritative for this project's specific rules (data sync flow, file
> preservation, session cookie, PayPal surcharges, winner-notification
> business rules) per `AGENTS.md`'s registry â this document covers general
> React architecture underneath those specific rules. If the two disagree,
> `patterns.md` wins.

This project targets React 19, TypeScript, Vite 6, functional components
only.

---

## Actual Project Layering

This app does **not** have a `lib â services â hooks â components` split
with a dedicated `src/services/` directory â there is no such directory.
The real frontend layering is:

```text
src/lib/        (mixed: some pure, some not â see below)
    ↓
src/context/    (AuctionContext.tsx, ConfigContext.tsx)
    ↓
src/hooks/      (useAuctionItems, useBundling, useGoogleAuth)
    ↓
src/components/
```

`src/lib/` currently mixes concerns: `categoryHelpers.ts` (49 lines) is
genuinely pure; `utils.ts` (7 lines, just `cn()`) is pure; but
`google-api.ts` (163 lines) does real network work â `fetchWithRetry`
reads `localStorage`, injects OAuth tokens into headers, and performs
`fetch()` calls with retry/backoff â and `firebase.ts` (73 lines)
initializes the Firestore/Auth SDK and holds live client references.
Neither of the latter two is a "no React, no network, deterministic"
pure module in the sense a generic `lib/` rule would want. This is a real
architectural gap relative to the ideal layering, not a design decision
to imitate in new code â new networked logic should go through a real
service-style module (or at minimum be clearly separated from anything
in `categoryHelpers.ts`-style pure code), and this split is worth
formalizing â see `refactor-opportunities.md`.

The Express backend layering (`server/routes/` â `server/services/` â
`server/middleware/`/`server/utils/`) is real and does follow the
intended one-way dependency direction â see `patterns.md` and
`file-reference.md`.

### `src/context/`

`AuctionContext.tsx` (532 lines) and `ConfigContext.tsx` (130 lines) hold
shared application/config state. `AuctionContext.tsx` in particular is
large for a context provider â worth a look if it's mixing multiple
unrelated concerns (see `refactor-opportunities.md`).

### `src/hooks/`

`useAuctionItems.ts` (117 lines), `useBundling.ts` (249 lines),
`useGoogleAuth.ts` (111 lines) coordinate service calls, loading state,
and workflow logic, exposing a clean hook API to components â this part
of the pattern is followed correctly.

### `src/components/`

Components display information and handle events. See
`component-standards.md` for the component-level rules; several existing
top-level views (`AuctionItemsTab.tsx` at 969 lines, `Bidders.tsx` and
`Checkout.tsx` at 644 lines each) have grown past the size where "avoid
embedding business logic" is still true in practice.

---

## Component Size

Preferred: 50â150 lines. Acceptable: 150â250 lines. Over 250: consider
refactoring. Over 400: almost certainly doing too much.

Real files currently over 400 lines in `src/components/`:
`AuctionItemsTab.tsx` (969), `Bidders.tsx` (644), `Checkout.tsx` (644),
`ConfigSettings.tsx` (572), `Dashboard.tsx` (517),
`TicketAttendeeTab.tsx` (446). These aren't a hypothetical "avoid this" â
they're the actual state of the codebase today, tracked in
`refactor-opportunities.md`. Don't add more responsibilities to these
files without considering a split first; new components should target
the 50â250 line range from the start.

---

## Derived State

Never store derived values in state â compute them in render. This is a
general rule, not something specific to this app, but worth restating
given how much of this app's UI is filtered/sorted table views (search
term â filtered list should be computed each render, not synced into a
second state variable via an effect).

---

## useEffect

Real `useEffect` usage in this codebase is already fairly disciplined â
`grep` shows 1â3 effects per file across `Dashboard.tsx`,
`AuctionItemsTab.tsx`, `Checkout.tsx`, `ConfigSettings.tsx`,
`Receipts.tsx`, `TicketAttendeeTab.tsx`, `DocumentCreationTab.tsx`,
`TicketDocumentCreationTab.tsx` â consistent with "only for real external
synchronization." Keep new effects to genuine external-system
synchronization (Google Sheets sync, Firestore listeners, browser APIs);
don't add an effect to compute a derived value or respond to a state
change that could be handled inline in render or in the event handler
that caused it.

---

## Memoization

`useMemo`/`useCallback` are already used sparingly in this codebase â a
handful of call sites in `AuctionItemsTab.tsx`, `Checkout.tsx`,
`Dashboard.tsx`, and `useAuctionItems.ts`. Don't reach for them by
default; this app's real usage pattern is closer to "only where there's
an actual expensive computation or a memoized child," which is the
correct target to keep matching.

---

## Server / Client Boundary

Components/hooks should never know API URLs, OAuth details, or database
structure directly. In this app: `getBaseUrl()` and `fetchWithRetry()` in
`src/lib/google-api.ts` are the one real chokepoint for talking to the
Express backend â route through them (or a hook that wraps them) rather
than calling `fetch()` directly from a component. The Express backend
(`server/routes/`, OAuth + Google Sheets proxy) should only ever be
reached this way from the frontend.

---

## Testing

25 test files exist today (`src/components/*.test.tsx` +
`server/test/*.test.ts`), matching `README.md`'s count. See
`testing-philosophy.md` (GOOD/SHALLOW/CIRCULAR/SMOKE ratings) and
`testing-batches.md` (partitioned test runs to avoid sandbox timeouts) â
those are the authoritative, already-correct docs for this app's testing
rules; this document doesn't restate them.

---

## AI Generation Rules

Prefer smaller components, composition, local state, readable code. When
touching one of the oversized files listed above, prefer extracting a
sub-component over adding more inline logic, even if the task at hand
doesn't strictly require it â but don't do large opportunistic refactors
inside an unrelated task; log the opportunity in
`refactor-opportunities.md` instead if it's out of scope.

If uncertain: choose the simpler implementation that matches this app's
existing real patterns over a generic "ideal" architecture doc.
