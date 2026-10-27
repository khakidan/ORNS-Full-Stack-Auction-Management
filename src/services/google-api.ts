import { SweeperStatus, PaypalSweepOutcome, ArchivedAuction } from "@/types";
import { newRequestId, reportDone, reportRetry } from "@/lib/syncStatus";
import { isConfiguredId } from "@/lib/configuredId";

export const getBaseUrl = () => {
  return "";
};

const MAX_RETRIES = 4;
const BASE_DELAY = 1000;

/**
 * Thrown when a request never got a usable answer: the network failed, or
 * the server kept answering 429/5xx through every retry. Distinct from a
 * Response with a 4xx status, which fetchWithRetry returns as-is - that's
 * the server answering "no", while this means it couldn't be reached.
 * The bid outbox (src/lib/bidOutbox.ts) keeps a bid for later on this
 * error and rolls back on a 4xx.
 */
export class ServerUnreachableError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ServerUnreachableError";
    this.cause = cause;
  }
}

export async function fetchWithRetry(url: string | URL | Request, options: RequestInit = {}, retries = MAX_RETRIES): Promise<Response> {
  let attempt = 0;
  // Retries are reported to the sync banner (src/lib/syncStatus.ts) instead
  // of only the console, so staff can see Google is slow (Milestone A).
  const requestId = newRequestId();

  // Authentication rides on the orns_session cookie, which the browser
  // sends automatically on these same-origin requests - no auth header
  // is added here.
  while (attempt < retries) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        const errorText = await response.clone().text().catch(() => "");
        throw new Error(`Transient API Error (${response.status}): ${errorText}`);
      }

      reportDone(requestId, true);
      return response;
    } catch (error: any) {
      if (attempt === retries - 1) {
        reportDone(requestId, false);
        throw new ServerUnreachableError(error);
      }

      const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[Retry Matrix] Request failed. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt + 1}/${retries})`);
      reportRetry(requestId, attempt + 2, retries);

      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }
  reportDone(requestId, false);
  throw new ServerUnreachableError(new Error("Maximum retries exceeded"));
}

/**
 * Sends a POST exactly once - no automatic retries, unlike fetchWithRetry.
 *
 * For requests that create something and aren't safe to repeat, such as
 * the Apps Script document and receipt runs: a timeout or server error
 * there often means the script is still running (or already finished),
 * so resending it made duplicate files. Returns the Response whatever its
 * status; throws ServerUnreachableError only if nothing came back at all.
 */
export async function postOnce(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
  } catch (error) {
    throw new ServerUnreachableError(error);
  }
}

/**
 * The most useful error text from a failed response's JSON body. The
 * server's error handler sends { error: "Internal Server Error", message },
 * so `message` (the real reason) wins when present.
 */
export function errorTextFrom(data: any, fallback: string): string {
  return data?.message || data?.error || fallback;
}

/** What to show when a document request got no answer at all. */
export const NO_ANSWER_MESSAGE =
  "No answer from the server. The document may still be created - check the folder before trying again.";

export async function getAuthUrl() {
  const res = await fetchWithRetry(`${getBaseUrl()}/auth/url`, { credentials: "include" });
  return res.json();
}

export async function getAuthStatus() {
  const res = await fetchWithRetry(`${getBaseUrl()}/auth/status`, { credentials: "include" });
  return res.json();
}

export async function logout() {
  const res = await fetchWithRetry(`${getBaseUrl()}/auth/logout`, { method: "POST", credentials: "include" });
  return res.json();
}

export async function getSheetData(spreadsheetId: string, range: string) {
  if (!isConfiguredId(spreadsheetId)) {
    return { values: [] };
  }
  const res = await fetchWithRetry(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}`, { credentials: "include" });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    if (res.status === 400 && (errorData.isRangeError || errorData.error?.includes("range"))) {
      console.warn(`[Google API Workspace] Sheet range/tab does not exist. It may need to be initialized in Settings: ${range}`);
      return { values: [] };
    }
    throw new Error(errorData.error || "Failed to fetch sheet data");
  }
  return res.json();
}

export async function updateSheetData(spreadsheetId: string, range: string, values: any[][]) {
  if (!isConfiguredId(spreadsheetId)) {
    throw new Error("Invalid Spreadsheet ID");
  }
  const res = await fetchWithRetry(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to update sheet data");
  }
  return res.json();
}

export async function appendSheetData(spreadsheetId: string, range: string, values: any[][]) {
  if (!isConfiguredId(spreadsheetId)) {
    throw new Error("Invalid Spreadsheet ID");
  }
  const res = await fetchWithRetry(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}/append`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to append sheet data");
  }
  return res.json();
}

export async function deleteAuctionItem(spreadsheetId: string, rowIndex: number) {
  if (!spreadsheetId) throw new Error("Invalid Spreadsheet ID");
  // idempotencyKey generated once here, before fetchWithRetry's internal
  // retries reuse this same body - matches add-item/bulk-update-items'
  // existing convention. Found in a hardening audit - see
  // docs/agents/CHANGELOG.md's Code Hardening item #1 /
  // CHANGELOG.md.
  const res = await fetchWithRetry(`${getBaseUrl()}/api/auction/delete-item`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spreadsheetId, rowIndex, idempotencyKey: window.crypto.randomUUID() }),
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to delete auction item");
  }
  return res.json();
}

export async function getPaypalSweeperStatus(): Promise<SweeperStatus> {
  const res = await fetchWithRetry(`${getBaseUrl()}/api/paypal-sweeper/status`, {
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to fetch PayPal sweeper status");
  }
  return res.json();
}

export async function runPaypalSweepNow(): Promise<PaypalSweepOutcome> {
  const res = await fetchWithRetry(`${getBaseUrl()}/api/paypal-sweeper/run-now`, {
    method: "POST",
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to run PayPal sweep");
  }
  return res.json();
}

export interface AppsScriptVersionStatus {
  label: string;
  expected: string;
  live: string | null;
  status: "ok" | "outdated" | "error";
  error?: string;
}

/** Asks each live Apps Script for its Version.gs fingerprint (read-only). */
export async function getAppsScriptVersions(): Promise<AppsScriptVersionStatus[]> {
  const res = await fetchWithRetry(`${getBaseUrl()}/api/apps-script/versions`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorTextFrom(data, "Failed to check the Apps Script versions"));
  return data.scripts;
}

export async function clearSheetData(spreadsheetId: string, range: string) {
  if (!isConfiguredId(spreadsheetId)) {
    throw new Error("Invalid Spreadsheet ID");
  }
  const res = await fetchWithRetry(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(range)}/clear`, {
    method: "POST",
    credentials: "include"
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to clear sheet data");
  }
  return res.json();
}

/** The past two auctions' archived spreadsheets on Drive (newest year first). */
export async function getArchivedAuctions(): Promise<ArchivedAuction[]> {
  const res = await fetchWithRetry(`${getBaseUrl()}/api/archive/auctions`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorTextFrom(data, "Couldn't look up the archived auctions."));
  return data.auctions || [];
}
