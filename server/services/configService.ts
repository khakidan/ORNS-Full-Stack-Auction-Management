import { getAdminFirestore } from "./firebaseAdmin";

/**
 * The shared auction Config (Firestore `settings/global`): which
 * spreadsheets and folders this year's auction uses, the ticket price and
 * the PayPal mode. Only the server reads and writes it (firebase-admin);
 * browsers get it from GET /api/config and save it through POST
 * /api/config (Full Administrators only), so every signed-in person sees
 * the current auction without a separate sign-in, and firestore.rules
 * keeps browsers out of the document entirely.
 *
 * Cached for CACHE_TTL_MS, like sharedConfig.ts: it's read on every
 * volunteer request. A save replaces the cached copy straight away.
 */
const DOC = () => getAdminFirestore().collection("settings").doc("global");
const CACHE_TTL_MS = 30 * 1000;

/** Each text field and its longest allowed value (the old firestore.rules limits). */
const TEXT_FIELDS = {
  auctionItemsSpreadsheetId: 256,
  auctionTicketsSpreadsheetId: 256,
  bidManagementSpreadsheetId: 256,
  bidderNumbersSheet: 128,
  bidManagementSheet: 128,
  receiptFolderId: 256,
  forPrintFolderId: 256,
  ornsLogoId: 256,
  ticketPrice: 10,
  auctionItemsScriptId: 256,
  auctionTicketsScriptId: 256,
  bidManagementScriptId: 256,
  bugReportsSpreadsheetId: 256,
  bugReportsFolderId: 256,
} as const;

type TextField = keyof typeof TEXT_FIELDS;
export type SharedConfig = Record<TextField, string> & { paypalIsSandbox: boolean };

/** Used for any field the document doesn't have yet (same as the browser's defaults). */
const DEFAULTS: SharedConfig = {
  ...(Object.fromEntries(Object.keys(TEXT_FIELDS).map((k) => [k, ""])) as Record<TextField, string>),
  bidderNumbersSheet: "Bidder-Numbers",
  bidManagementSheet: "Bid-Management",
  ticketPrice: "35",
  paypalIsSandbox: true,
};

let cached: { config: SharedConfig; readAt: number } | null = null;

/** Copies only Config's own fields, so a stale key in the document never travels on. */
function fromDocument(d: Record<string, unknown>): SharedConfig {
  const config = { ...DEFAULTS };
  for (const key of Object.keys(TEXT_FIELDS) as TextField[]) {
    if (typeof d[key] === "string") config[key] = d[key] as string;
  }
  // Anything but an explicit false is sandbox, so a missing field never means live.
  config.paypalIsSandbox = d.paypalIsSandbox !== false;
  return config;
}

/** The current Config. If a refresh fails, the last one read is used; with none, it throws. */
export async function getSharedConfig(now = Date.now()): Promise<SharedConfig> {
  if (cached && now - cached.readAt < CACHE_TTL_MS) return cached.config;
  try {
    const config = fromDocument((await DOC().get()).data() || {});
    cached = { config, readAt: now };
    return config;
  } catch (err: any) {
    if (cached) {
      console.warn("[configService] Couldn't refresh the Config from Firestore; using the last one read:", err?.message || err);
      return cached.config;
    }
    throw err;
  }
}

export class InvalidConfigError extends Error {}

/** Checks a Config sent by the browser; throws InvalidConfigError naming the first bad field. */
export function validateConfig(input: unknown): SharedConfig {
  if (!input || typeof input !== "object") throw new InvalidConfigError("No settings were sent.");
  const body = input as Record<string, unknown>;
  const config = { ...DEFAULTS };
  for (const [key, max] of Object.entries(TEXT_FIELDS) as [TextField, number][]) {
    const value = body[key] ?? "";
    if (typeof value !== "string") throw new InvalidConfigError(`${key} must be text.`);
    if (value.length > max) throw new InvalidConfigError(`${key} is too long (at most ${max} characters).`);
    config[key] = value.trim();
  }
  if (typeof body.paypalIsSandbox !== "boolean") throw new InvalidConfigError("paypalIsSandbox must be true or false.");
  config.paypalIsSandbox = body.paypalIsSandbox;
  return config;
}

/** Saves the whole Config; returns what it replaced, for Action History. */
export async function saveSharedConfig(config: SharedConfig, updatedBy: string, now = Date.now()): Promise<SharedConfig> {
  const before = fromDocument((await DOC().get()).data() || {});
  await DOC().set({ ...config, updatedAt: new Date(now), updatedBy });
  cached = { config, readAt: now };
  return before;
}

/**
 * Changes some fields, keeping the rest as Firestore has them now (not as
 * the cache does, so a save from another screen isn't lost). Used by
 * Setup New Auction Year for the new folder IDs. Returns what it replaced.
 */
export async function updateSharedConfigFields(fields: Partial<SharedConfig>, updatedBy: string, now = Date.now()): Promise<SharedConfig> {
  const before = fromDocument((await DOC().get()).data() || {});
  const config = { ...before, ...fields };
  await DOC().set({ ...config, updatedAt: new Date(now), updatedBy });
  cached = { config, readAt: now };
  return before;
}

/** Test-only. */
export function _resetConfigCacheForTesting(): void {
  cached = null;
}
