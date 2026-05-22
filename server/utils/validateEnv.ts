/**
 * Validates required environment variables on boot.
 */
export function validateEnv(): void {
  const requiredEnvVars = [
    "SESSION_SECRET",
    "GEMINI_API_KEY",
    "SCRIPT_ID_BID_MANAGEMENT",
    "SCRIPT_ID_ITEM_ENTRY",
    "SCRIPT_ID_TICKETS"
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`\n[FATAL SYSTEM ERROR] Boot aborted. Missing required environment variable: ${envVar}\n`);
      process.exit(1);
    }
  }
}
