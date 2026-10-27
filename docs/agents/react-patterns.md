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

The real frontend layering is:

```text
src/lib/        (mostly pure helpers: parsing, pricing, formatting)
src/services/   (network clients: google-api.ts, apiClient.ts)
    ↓
src/context/    (AuctionContext.tsx, ConfigContext.tsx, AuthContext.tsx)
    ↓
src/hooks/      (data hooks like useAuctionItems/useWinnersData, and a
                 use...State hook per screen)
    ↓
src/components/
```

`src/lib/` is mostly pure: `categoryHelpers.ts`, `bidGridParsing.ts`,
`auctionItemPricing.ts`, `utils.ts` (`cn()`) and most of the rest take
data in and hand data back. The exceptions are deliberate:
`bidOutbox.ts` (the offline bid outbox) keeps unsent bids in
`localStorage` and resends them through `fetchWithRetry`, and
`errorBuffer.ts` keeps recent console errors for bug reports. Other
network and SDK code lives in `src/services/`:
`google-api.ts` (`fetchWithRetry`, `getBaseUrl`, the Sheets/Drive
helpers) and `apiClient.ts` (`postJson` and `HttpError` for JSON POSTs to the
backend). The browser has no Firebase SDK: the shared Config comes from
`GET /api/config` (`ConfigContext.tsx`).
Requests authenticate with the `orns_session` cookie
(`credentials: "include"`) - the browser never holds OAuth tokens. New
networked logic belongs in `src/services/`, not `src/lib/`.

---

## Server / Client Boundary

Components/hooks should never know API URLs, OAuth details, or database
structure directly. In this app: `getBaseUrl()` and `fetchWithRetry()` in
`src/services/google-api.ts` (plus `postJson` in `src/services/apiClient.ts`,
built on them) are the one real chokepoint for talking to the Express
backend - route through them (or a hook that wraps them) rather
than calling `fetch()` directly from a component. The Express backend
(`server/routes/`, OAuth + Google Sheets proxy) should only ever be
reached this way from the frontend.

---

## Testing

Tests sit next to the code they cover (`src/**/*.test.ts(x)`,
`server/**/*.test.ts`). See `testing-philosophy.md`
(GOOD/SHALLOW/CIRCULAR/SMOKE ratings) and `testing-batches.md` (how to
run the suite, and the current totals) -
those are the authoritative, already-correct docs for this app's testing
rules; this document doesn't restate them.

---

## AI Generation Rules

Prefer smaller components, composition, local state, readable code. When
touching one of the oversized files listed above, prefer extracting a
sub-component over adding more inline logic, even if the task at hand
doesn't strictly require it - but don't do large opportunistic refactors
inside an unrelated task; log the opportunity in
`ROADMAP.md`'s audit backlog instead if it's out of scope.

If uncertain: choose the simpler implementation that matches this app's
existing real patterns over a generic "ideal" architecture doc.
