# Roadmap: What's Left Before the Auction

What still has to be **done, tested or checked** for the **ORNS Charity Auction Manager**, in the order it should happen. The next auction is March/April 2027.

**How to use this file:** work down the sections in order. When something is done, delete it here and record what happened (and when) in [`CHANGELOG.md`](./CHANGELOG.md). This file only ever shows what's still outstanding.

**Who:** *Admin* = someone with the Administrator or Full Administrator role in the app. *Developer* = whoever maintains the code and Google Cloud (Cloud Run, Cloud Build, Secret Manager).

---

## 1. Any time now - one-time setup (Developer)

- [ ] **Point the Cloud Build trigger at `cloudbuild.yaml`**, once the PR that adds it is merged. Until then the file is ignored and the trigger keeps its old built-in settings.
  - Cloud Build > Triggers (region europe-west1) > `cloudrun-orns-auction-manager-gh-...` > Edit > Configuration: **Cloud Build configuration file**, location **Repository**, path `cloudbuild.yaml` > Save.
  - **Check it worked:** the next deploy's build log has a "Prune old revisions" step, Cloud Run lists at most 15 revisions afterwards, and the build takes a few minutes instead of ~20.
- [ ] **Keep only the newest 15 images** in Artifact Registry (the images behind old revisions; 139 on 2026-10-31). Artifact Registry > `cloud-run-source-deploy` (us-east1) > Edit > Cleanup policies: a **Keep most recent versions: 15** policy, plus a **Delete** policy for any tag state. Cleanup runs about once a day.

## 2. On the day ticket sales open (Admin + Developer)

PayPal **Paid** and **Refunded** have only run in tests: the sandbox held its test payments for review and never released or refunded them. This is their first real run.

- [ ] **Switch PayPal to live:** Settings > PayPal Integration > Live. Check Fluent Forms' PayPal is on **Live Mode** paying `pavetheway@orns.org` - the two must match, or every real payment lands on the Needs review list. (The live credentials are on the server, checked 2026-10-30.)
- [ ] **Buy one real ticket** with a real card from form 7's Preview link (works before the form is published), then click **Check Now** on Website Ticket Check.
  - **Expect:** the row goes **Paid**, and (in Prep) the buyer gets a bidder number.
- [ ] **Refund it** in PayPal (`pavetheway@orns.org`'s account), then click **Check Now**.
  - **Expect:** the row goes **Refunded** and shows under Needs review.
- [ ] **Clean up:** click **Clear** on that Needs review line, delete the test ticket row and its bidder, and trash the entry in Fluent Forms. PayPal may keep part of its fee on the refund.
- [ ] **Publish form 7** for the season.

## 3. First week of ticket sales (Admin)

- [ ] **Look at Website Ticket Check every day or two.** Each website purchase should show as added, with no Needs review line you can't explain.
  - If it says the server has **no stored Google sign-in**, a staff member must sign in to the app once. Until then website purchases aren't written (the 5-hourly check adds them afterwards).
  - A held PayPal payment clears itself once PayPal releases it. If one is still held after a few days, look it up in PayPal.

## 4. 3-4 weeks before the auction - dress rehearsal (Admin, with 3-4 helpers)

The automated tests (2,100+) use stand-ins for Google, PayPal and Apps Script; this is the one chance to run the whole night for real before it counts. Work on **copies** of the three spreadsheets, set in Settings > Configuration, so no real data is touched.

- [ ] **Set Up** (Bid Management).
  - **Expect:** bidders built from the tickets; the standard items (Movie Night, raffle tickets, Open Appeal, Auction Tickets) on the Auction Items page with their prices; Auction Tickets at this year's ticket price.
- [ ] **Print the documents** (catalog, bid sheets, table tents, bidding guide, labels, slideshow).
  - **Expect:** no standard items in any of them; the slideshow still ends with the Open Appeal slides.
- [ ] **Go Live**, then have **3-4 people enter winning bids at the same time**, on different devices, for 10-15 minutes. Include the same raffle item for several bidders.
  - **Expect:** no lost or doubled bids (compare against paper), no errors, nothing slow.
- [ ] **Register 2 walk-ins**, one paying by card and one by cash.
- [ ] **Checkout** one bidder by card (PayPal invoice), one by **cash** and one by **check**.
  - **Expect:** for cash and check, the card fee comes off the PayPal invoice and no warning shows.
- [ ] **Live checkout with real money:** with PayPal on live, check out a $1 test item by card, and a second $1 item marked paid by **cash**.
  - **Expect:** the cash invoice drops its card fee - the live account's first fee removal. Refund or cancel both in PayPal afterwards.
- [ ] **Receipts:** generate **all** receipts, and email one.
  - **Expect:** it finishes. It's the slowest Apps Script job, so watch for a time-out.
- [ ] **Close** the auction, then point Settings back at the real spreadsheets.

## 5. The week before the auction (Developer + Admin)

- [ ] **Deploy freeze:** merge nothing to `main` this week unless it fixes a problem the rehearsal found. Every merge deploys straight to the live app.
- [ ] **Check the Apps Scripts are current:** `npm run gas:check` (each deployed script version should match the code).
- [ ] **Keep the app awake** for auction week, so nobody waits for it to start up: `gcloud run services update orns-auction-manager-gh --region=us-east1 --min-instances=1`. Costs a few dollars for the week; undo it in section 7.
- [ ] **Run Set Up for real** once ticket sales have closed, then print the bidder labels and documents.
- [ ] **Plan for the venue's internet failing:** a phone hotspot the bid-entry devices can join, and the printed bid sheets as the paper record. Bids can be entered afterwards; Action History and Undo handle corrections.

## 6. Auction day (Admin)

- [ ] **Go Live** when bidding opens, and **Close** when it ends.
- [ ] Watch the **Bought after Go Live** list on Website Ticket Check: register each as a walk-in, then click **Done**.

## 7. After the auction (Developer)

- [ ] **Let the app sleep again:** `gcloud run services update orns-auction-manager-gh --region=us-east1 --min-instances=0`.

---

## Ideas (not started)

- **An email alert when website purchases can't be written** (no stored Google sign-in, or a check failing), so nobody has to remember to look at Website Ticket Check.
- **A staging copy of the app** that `main` deploys to first, so a change can be tried before it reaches the live app.

---

## Reference: past audits (all done)

The code audits of 2026-10-21, 2026-10-27 (A1-A17) and 2026-10-28 (B1-B14), and the test audit of 2026-10-29 (T1-T18), are finished; each item's details are in `CHANGELOG.md` (search for its ID). How the suite is run and checked (CI, coverage, mutation testing) is in [`testing-batches.md`](./testing-batches.md). What those audits confirmed is fine, so nobody "fixes" it later:

- **Access:** every `/api` router is behind `requireAuth` except bug-report submission (rate-limited, deliberately open), `/api/health` and the Cloud Scheduler endpoint (secret compared in constant time). `requireAuth` and `requirePermission` deny by default; the volunteer allowlist is case- and trailing-slash-strict. `firestore.rules` denies browsers everything.
- **Web safety:** no `dangerouslySetInnerHTML`, `innerHTML` or `eval`; server-rendered HTML is escaped. Same-origin only, JSON bodies, `sameSite: lax` cookie. `trust proxy` is 1, so rate limits see the real client IP.
- **Data:** Action History rows are written `RAW`, and the Apps Scripts prefix `=`, `+` and `@` with `'`. Go Live only moves from Prep; Close ends volunteer access.
- **One server copy:** the locks, cache and live-refresh feed live in memory. That's correct because the service is capped at one instance: service-level `maxScale: 1`, and `--max-instances=1` on each revision from `cloudbuild.yaml`.
- **Spreadsheets:** Set Up gives Bidder-Numbers, Bid-Management and Auction-Status a warning-only protection, so anyone editing them by hand is asked to confirm. Everyone keeps edit access, `web-admin@orns.org` included, because the app writes as each staff member's own Google account.
- **Tests:** no skipped or `.only` tests; no test mocks the module it tests; route tests use the real Express app and session cookie, with Google, PayPal and WordPress behind MSW and an in-memory Firestore.
- **Website purchases:** the form's Google Sheets feed (feed 89) is off. Never turn it back on while `FLUENT_FORMS_TICKETS_MODE=write`, or a purchase is added twice. The Cloud Scheduler job `fluent-forms-poll` runs all year (free while nothing changes). Set-up details are in `README.md` ("Ticket payments (W4)", "Website ticket poll", "Website Ticket Check", "Purchases after Go Live").
