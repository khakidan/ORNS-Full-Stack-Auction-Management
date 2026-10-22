# Not deployed

These files are kept for reference only and are **never pushed** to the live Bid-Management script (its `.clasp.json` sets `skipSubdirectories: true`).

- `Class_PayPalService.gs`, `PayPalSweeper.gs`: the old Apps Script PayPal service and checker. The app's server replaced them (`server/services/paypalService.ts`, `server/services/paypalSweeperJob.ts`).
- `API_PAYPAL_TESTS.gs`: manual tests that created and sent real PayPal invoices. Removed from the live script on 2026-10-22 so they can't be run by hand from the editor.
- `PayPalService_UnitTests.gs`, `GoogleAIStudioAndSweeper_UnitTests.gs`: in-editor tests for the two files above.

`server/test/gs-paypal-service.test.ts` and `gs-paypal-sweeper.test.ts` still load the PayPal files from here. `server/test/gs-push-order.test.ts` fails if PayPal code appears in a deployed file.
