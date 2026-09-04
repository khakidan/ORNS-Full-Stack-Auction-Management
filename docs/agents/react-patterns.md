# React Patterns & Architecture

> **Status: written for this codebase's actual current state**, verified
> against `src/` on 2026-09-02. [`patterns.md`](./patterns.md) is
> authoritative for this project's specific rules (data sync flow, file
> preservation, session cookie, PayPal surcharges, winner-notification
> business rules) per `AGENTS.md`'s registry - this document covers general
> React architecture underneath those specific rules. If the two disagree,
> `patterns.md` wins.

This project targets React 19, TypeScript, Vite 6, functional components
only.

---

## Actual Project Layering

This app does **not** have a `lib - services - hooks - components` split
with a dedicated `src/services/` directory - there is no such directory.
The real frontend layering is:

```text
src/lib/        (mixed: some pure, some not - see below)
    ↓
src/context/    (AuctionContext.tsx, ConfigContext.tsx)
    ↓
src/hooks/      (useAuctionItems, useBundling, useGoogleAuth)
    ↓
src/components/
```

`src/lib/` currently mixes concerns: `categoryHelpers.ts` (49 lines) is
genuinely pure; `utils.ts` (7 lines, just `cn()`) is pure; but
`google-api.ts` (163 lines) does real network work - `fetchWithRetry`
reads `localStorage`, injects OAuth tokens into headers, and performs
`fetch()` calls with retry/backoff - and `firebase.ts` (73 lines)
initializes the Firestore/Auth SDK and holds live client references.
Neither of the latter two is a "no React, no network, deterministic"
pure module in the sense a generic `lib/` rule would want. This is a real
architectural gap relative to the ideal layering, not a design decision
to imitate in new code - new networked logic should go through a real
service-style module (or at minimum be clearly separated from anything
in `categoryHelpers.ts`-style pure code), and this split is worth
formalizing - see `refactor-opportunities.md`.

The Express backend layering (`server/routes/` - `server/services/` -
`server/middleware/`/`server/utils/`) is real and does follow the
intended one-way dependency direction - see `patterns.md` and
`file-reference.md`.

### `src/context/`

`AuctionContext.tsx` and `ConfigContext.tsx` hold shared application/
config state. `AuctionContext.tsx` used to be large (532 lines) for a
context provider, mixing several unrelated concerns - as of 2026-09-04
it's a 118-line container composing split-out `src/hooks/use*Data.ts`
hooks (`useBiddersData`, `useItemsData`, `useAttendeesData`,
`useWinnersData`, `useAuctionStatusData`), the same container-hook
pattern now used throughout `src/hooks/`.

### `src/hooks/`

`useAuctionItems.ts` (117 lines), `useBundling.ts` (249 lines),
`useGoogleAuth.ts` (111 lines) coordinate service calls, loading state,
and workflow logic, exposing a clean hook API to components - this part
of the pattern is followed correctly.

### `src/components/`

Components display information and handle events. See
`component-standards.md` for the component-level rules. Every top-level
view that used to be oversized has since been split via the
container-hook pattern - a thin `src/components/*.tsx` view composing a
`src/hooks/use*State.ts` hook that owns the actual state/business logic.

---

## Component Size

Preferred: 50-150 lines. Acceptable: 150-250 lines. Over 250: consider
refactoring. Over 400: almost certainly doing too much.

As of 2026-09-04, no file under `src/components/` (excluding `ui/`)
exceeds 250 lines - the largest is `BundlingDialog.tsx` at 182. The six
files this section used to cite as real, current examples of "over
400 lines" have all been split: `AuctionItemsTab.tsx` 969 → 181,
`Bidders.tsx` 644 → 107, `Checkout.tsx` 644 → 143, `ConfigSettings.tsx`
572 → 64, `Dashboard.tsx` 517 → 57, `TicketAttendeeTab.tsx` 446 → 120.
Keep new components in the 50-250 line range from the start rather than
letting this drift back - when a view starts mixing search/filter
state, business logic, and rendering again, extract a `use*State.ts`
hook the same way these six were split, before it grows past 250 lines.

---

## Derived State

Never store derived values in state - compute them in render. This is a
general rule, not something specific to this app, but worth restating
given how much of this app's UI is filtered/sorted table views (search
term - filtered list should be computed each render, not synced into a
second state variable via an effect).

---

## useEffect

Real `useEffect` usage in this codebase is already fairly disciplined -
`grep` shows 1-3 effects per file across `Dashboard.tsx`,
`AuctionItemsTab.tsx`, `Checkout.tsx`, `ConfigSettings.tsx`,
`Receipts.tsx`, `TicketAttendeeTab.tsx`, `DocumentCreationTab.tsx`,
`TicketDocumentCreationTab.tsx` - consistent with "only for real external
synchronization." Keep new effects to genuine external-system
synchronization (Google Sheets sync, Firestore listeners, browser APIs);
don't add an effect to compute a derived value or respond to a state
change that could be handled inline in render or in the event handler
that caused it.

---

## Memoization

`useMemo`/`useCallback` are already used sparingly in this codebase - a
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
Express backend - route through them (or a hook that wraps them) rather
than calling `fetch()` directly from a component. The Express backend
(`server/routes/`, OAuth + Google Sheets proxy) should only ever be
reached this way from the frontend.

---

## Testing

25 test files exist today (`src/components/*.test.tsx` +
`server/test/*.test.ts`), matching `README.md`'s count. See
`testing-philosophy.md` (GOOD/SHALLOW/CIRCULAR/SMOKE ratings) and
`testing-batches.md` (partitioned test runs to avoid sandbox timeouts) -
those are the authoritative, already-correct docs for this app's testing
rules; this document doesn't restate them.

---

## AI Generation Rules

Prefer smaller components, composition, local state, readable code. When
touching one of the oversized files listed above, prefer extracting a
sub-component over adding more inline logic, even if the task at hand
doesn't strictly require it - but don't do large opportunistic refactors
inside an unrelated task; log the opportunity in
`refactor-opportunities.md` instead if it's out of scope.

If uncertain: choose the simpler implementation that matches this app's
existing real patterns over a generic "ideal" architecture doc.
