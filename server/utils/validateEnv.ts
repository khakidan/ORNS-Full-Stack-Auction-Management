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
    "DRIVE_TEMPLATE_FILES_FOLDER_ID",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "TEMPLATE_VOLUNTEER_BUSINESS_FOLLOWUP_FAQS_ID",
    "TEMPLATE_VOLUNTEER_EMAIL_SCRIPT_AND_TALKING_POINTS_ID",
    "TEMPLATE_NIGHT_OF_AUCTION_VOLUNTEERS_ID",
    "TEMPLATE_REPEAT_DONOR_LETTER_ID",
    "TEMPLATE_NEW_DONOR_LETTER_ID",
    "TEMPLATE_DONATION_FORM_ID",
    "TEMPLATE_PROJECT_MANAGEMENT_TEMPLATE_ID",
    "TEMPLATE_INITIAL_PLANNING_MEETING_ID"
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      // Configuration variables should not crash the app on boot to allow the management UI to load.
      if (envVar.startsWith("DRIVE_") || envVar.startsWith("SCRIPT_ID_") || envVar.startsWith("TEMPLATE_")) {
        console.warn(`\n[WARNING] Configuration variable missing: ${envVar}. Some features may be degraded until this is set (in .env locally, or the Cloud Run service's environment variables).\n`);
        continue;
      }
      console.error(`\n[FATAL SYSTEM ERROR] Boot aborted. Missing required environment variable: ${envVar}\n`);
      process.exit(1);
    }
  }
}
