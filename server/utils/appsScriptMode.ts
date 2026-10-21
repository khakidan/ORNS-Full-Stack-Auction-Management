/**
 * Whether Apps Script calls (`scripts.run`) run the script editor's
 * latest *saved* code instead of its versioned API-executable deployment
 * (ROADMAP.md M6).
 *
 * Off by default: `devMode: true` only takes effect for the script's
 * owner, so with it on, the owner silently ran unreleased editor code
 * while every other staff member ran the deployed version - two people
 * clicking the same button could get different behavior. With it off,
 * everyone runs the deployed version, which means a .gs change only goes
 * live after Deploy > Manage deployments > (the API executable) > Edit >
 * Version: New version in that script's editor.
 *
 * Set APPS_SCRIPT_DEV_MODE=true (e.g. in a local .env) to try editor
 * changes before deploying them - as the script owner.
 */
export function appsScriptDevMode(): boolean {
  return (process.env.APPS_SCRIPT_DEV_MODE || "").trim().toLowerCase() === "true";
}
