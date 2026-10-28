/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./server/test/setup.ts"],
    // Node 22+'s own experimental localStorage global hides jsdom's, which
    // the frontend tests need. Set here (not only in `npm run test:quiet`)
    // so `npx vitest run src`, an editor's test runner, or one test file run
    // by hand behave the same (ROADMAP B14).
    execArgv: ["--no-experimental-webstorage"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    env: {
      SESSION_SECRET: "test-session-secret-for-vitest",
      GEMINI_API_KEY: "test-gemini-api-key",
      SCRIPT_ID_BID_MANAGEMENT: "test-bid-mgmt-script-id",
      SCRIPT_ID_ITEM_ENTRY: "test-item-entry-script-id",
      SCRIPT_ID_TICKETS: "test-tickets-script-id",
      DRIVE_PARENT_FOLDER_ID: "test-drive-parent-folder-id",
      DRIVE_ARCHIVE_FOLDER_ID: "test-drive-archive-folder-id",
      DRIVE_TEMPLATE_FILES_FOLDER_ID: "test-template-files-folder-id",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      TEMPLATE_VOLUNTEER_BUSINESS_FOLLOWUP_FAQS_ID: "test-template-volunteer-business-followup-faqs-id",
      TEMPLATE_VOLUNTEER_EMAIL_SCRIPT_AND_TALKING_POINTS_ID: "test-template-volunteer-email-script-and-talking-points-id",
      TEMPLATE_NIGHT_OF_AUCTION_VOLUNTEERS_ID: "test-template-night-of-auction-volunteers-id",
      TEMPLATE_REPEAT_DONOR_LETTER_ID: "test-template-repeat-donor-letter-id",
      TEMPLATE_NEW_DONOR_LETTER_ID: "test-template-new-donor-letter-id",
      TEMPLATE_DONATION_FORM_ID: "test-template-donation-form-id",
      TEMPLATE_PROJECT_MANAGEMENT_TEMPLATE_ID: "test-template-project-management-template-id",
      TEMPLATE_INITIAL_PLANNING_MEETING_ID: "test-template-initial-planning-meeting-id",
      // Deterministic test credentials so server/services/paypalService.ts's
      // env-var fallback never depends on (or hits) whatever real
      // credentials happen to be in a developer's local .env - all PayPal
      // network calls in tests go through msw's mocked handlers anyway
      // (server/test/handlers.ts), never real PayPal, sandbox or otherwise.
      PAYPAL_CLIENT_ID: "test-paypal-client-id",
      PAYPAL_CLIENT_SECRET: "test-paypal-client-secret",
      PAYPAL_IS_SANDBOX: "true",
      // The default test session (server/test/helpers/session.ts) signs in
      // as this address, so it is a Full Administrator without Firestore.
      FULL_ADMIN_EMAILS: "test-admin@orns.org",
      VOLUNTEER_GOOGLE_ACCOUNT: "auction-volunteers@orns.org",
      NODE_ENV: "test",
    },
    // @ts-ignore
    environmentMatchGlobs: [
      ["src/**/*.test.tsx", "jsdom"],
      ["src/**/*.test.ts", "jsdom"],
    ],
  },
});
