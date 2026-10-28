import { Router } from "express";
import { requirePermission } from '../middleware/requirePermission';
import { google } from "googleapis";
import { getAuthenticatedClient } from "../services/oauth";
import { requireAuth } from "../middleware/requireAuth";
import { runAppsScript } from "../utils/appsScriptRun";
import { EXPECTED_APPS_SCRIPT_VERSIONS } from "../generated/appsScriptVersions";

/** Folder name under scripts/GoogleAppsScriptsCode -> label and Script ID setting. */
const SCRIPTS: { project: keyof typeof EXPECTED_APPS_SCRIPT_VERSIONS; label: string; envVar: string }[] = [
  { project: "BidManagementSpreadsheet", label: "Bid Management", envVar: "SCRIPT_ID_BID_MANAGEMENT" },
  { project: "ItemsSpreadsheet", label: "Item Entry", envVar: "SCRIPT_ID_ITEM_ENTRY" },
  { project: "TicketsSpreadsheet", label: "Tickets", envVar: "SCRIPT_ID_TICKETS" },
];

export interface AppsScriptVersionStatus {
  label: string;
  /** The fingerprint this build of the app expects (Version.gs in the repo). */
  expected: string;
  /** What the live script reported; null if it couldn't be asked. */
  live: string | null;
  status: "ok" | "outdated" | "error";
  error?: string;
}

/**
 * GET /api/apps-script/versions - asks each live Apps Script for its
 * Version.gs fingerprint and compares it with the one this build expects
 * (server/generated/appsScriptVersions.ts, written by `npm run gas:stamp`).
 *
 * "outdated" means the live script isn't the code in this build's repo:
 * not redeployed after a change, or deployed from somewhere else. A
 * read-only call, run by hand from the Settings page.
 */
export default function createAppsScriptRouter() {
  const router = Router();
  router.use(requireAuth);
  // Mounted at its own "/api/apps-script" prefix, so router.use() here only
  // covers this router's routes.
  router.use(requirePermission("settings.system"));

  router.get("/versions", async (req, res) => {
    const client = getAuthenticatedClient(req.session.tokens);
    const script = google.script({ version: "v1", auth: client });

    const results = await Promise.all(SCRIPTS.map(async ({ project, label, envVar }): Promise<AppsScriptVersionStatus> => {
      const expected = EXPECTED_APPS_SCRIPT_VERSIONS[project];
      const scriptId = process.env[envVar];
      if (!scriptId) return { label, expected, live: null, status: "error", error: `${envVar} isn't set on the server.` };
      try {
        const result = await runAppsScript(script, scriptId, "apiGetVersion", []);
        const live = typeof result?.version === "string" ? result.version : null;
        if (!live) return { label, expected, live: null, status: "error", error: "The script didn't report a version." };
        return { label, expected, live, status: live === expected ? "ok" : "outdated" };
      } catch (error: any) {
        const message = String(error?.message || error);
        // A script deployed before Version.gs existed has no apiGetVersion.
        const friendly = /apiGetVersion/.test(message) && /not found/i.test(message)
          ? "This script has no version check yet - it was deployed before Version.gs existed."
          : message;
        return { label, expected, live: null, status: "error", error: friendly };
      }
    }));

    res.json({ scripts: results });
  });

  return router;
}
