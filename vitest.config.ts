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
      NODE_ENV: "test",
    },
  },
});
