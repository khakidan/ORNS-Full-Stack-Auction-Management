/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./server/test/setup.ts"],
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
      NODE_ENV: "test",
    },
    // @ts-ignore
    environmentMatchGlobs: [
      ["src/**/*.test.tsx", "jsdom"],
      ["src/**/*.test.ts", "jsdom"],
    ],
  },
});
