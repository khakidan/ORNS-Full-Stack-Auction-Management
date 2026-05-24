/**
 * Validates required environment variables on boot.
 */
export function validateEnv(): void {
  const requiredEnvVars = [
    "SESSION_SECRET",
    "GEMINI_API_KEY",
    "SCRIPT_ID_BID_MANAGEMENT",
    "SCRIPT_ID_ITEM_ENTRY",
    "SCRIPT_ID_TICKETS",
    "DRIVE_PARENT_FOLDER_ID",
    "DRIVE_ARCHIVE_FOLDER_ID",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET"
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      // Configuration variables should not crash the app on boot to allow the management UI to load.
      if (envVar.startsWith("DRIVE_") || envVar.startsWith("SCRIPT_ID_")) {
        console.warn(`\n[WARNING] Configuration variable missing: ${envVar}. Some features may be degraded until this is set in the Secrets panel.\n`);
        continue;
      }
      console.error(`\n[FATAL SYSTEM ERROR] Boot aborted. Missing required environment variable: ${envVar}\n`);
      process.exit(1);
    }
  }
}
