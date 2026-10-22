# ORNS Charity Auction Manager

Web app for running Orchard Ridge Nursery School's charity auction: guest check-in, bidder numbers, item entry and bundling, live bid entry, checkout with PayPal invoicing, and receipts. React + Vite on the front end, Express on the back end, Google Sheets as the datastore, Firestore for shared settings.

Live at **<https://orns-auction-manager.cloud.run>**.

## Run Locally

**Prerequisites:** Node.js 22.

1. `npm install`
2. `cp .env.example .env` and fill in the values (OAuth client, `SESSION_SECRET`, `GEMINI_API_KEY`, PayPal sandbox credentials, `APP_URL=http://localhost:3000`).
3. Add `http://localhost:3000/auth/callback` to the OAuth client's Authorized redirect URIs in Google Cloud Console.
4. `npm run dev`, then open <http://localhost:3000>.

A local server uses the same shared settings, and therefore the same spreadsheets, as production. Full setup notes, including that caveat, are in [docs/agents/README.md](docs/agents/README.md#running-locally).

## Test

```bash
npm run test:quiet   # full test suite
npm run lint         # type check
```

## Deploy

Every push to `main` deploys to production (Cloud Build -> Cloud Run service `orns-auction-manager-gh`, us-east1). Work on a branch and merge to `main` when the change is ready to go live. See [docs/agents/README.md](docs/agents/README.md#deployment).

## Docs

[AGENTS.md](AGENTS.md) is the entry point: the project rules and an index of everything under [docs/agents/](docs/agents/).
