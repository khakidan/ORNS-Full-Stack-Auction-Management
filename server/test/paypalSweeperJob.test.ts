/**
 * Tests server/services/paypalSweeperJob.ts - the Node port of
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/not-deployed/PayPalSweeper.gs's
 * `checkPendingPayPalInvoices` (Code Hardening item #2, Step 4).
 * `firebaseAdmin.ts` and `paypalService.ts` are fully module-mocked so
 * these tests never touch real Firestore or PayPal - only the Sheets API
 * calls go through MSW, matching this repo's usual convention.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, valuesBatchUpdateRequests } from "./handlers";

const mockExtractInvoiceIdFromUrl = vi.fn();
const mockGetInvoiceStatus = vi.fn();
let lastPayPalServiceCtorArgs: any = null;

vi.mock("../services/paypalService", async (importOriginal) => ({
  isPaidInvoiceStatus: (await importOriginal<typeof import("../services/paypalService")>()).isPaidInvoiceStatus,
  PayPalService: vi.fn().mockImplementation(function (this: any, args: any) {
    lastPayPalServiceCtorArgs = args;
    return {
      extractInvoiceIdFromUrl: mockExtractInvoiceIdFromUrl,
      getInvoiceStatus: mockGetInvoiceStatus,
    };
  }),
}));

let sweeperDoc: any = { refreshToken: "sweeper-refresh-token" };
let configDoc: any = { bidManagementSpreadsheetId: "bm-id", bidderNumbersSheet: "Bidder-Numbers", paypalIsSandbox: true };
const capturedSets: { collection: string; doc: string; data: any }[] = [];

function makeFakeAdminDb() {
  return {
    collection: (collectionName: string) => ({
      doc: (docId: string) => ({
        get: async () => ({
          data: () => {
            if (collectionName === "system" && docId === "paypalSweeperAuth") return sweeperDoc;
            if (collectionName === "settings" && docId === "global") return configDoc;
            return undefined;
          },
        }),
        set: async (data: any) => {
          capturedSets.push({ collection: collectionName, doc: docId, data });
        },
      }),
    }),
  };
}

vi.mock("../services/firebaseAdmin", () => ({
  getAdminFirestore: () => makeFakeAdminDb(),
}));

import { runPaypalSweep, persistSweeperCredential, getSweeperStatus } from "../services/paypalSweeperJob";

const HEADER = ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid", "Method", "InvoiceURL", "Amount", "Timestamp"];

function pendingRow(overrides: Record<number, any> = {}) {
  const row: any[] = ["101", "Jane", "Doe", "jane@example.com", true, false, false, false, "PayPal Verification Pending", "https://www.paypal.com/invoice/p/#INV2-X", 104.12, new Date().toISOString()];
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

/**
 * Serves the whole sheet for a full-column read (the sweep's snapshot),
 * and just that row for a single-row `A{n}:L{n}` read (the sweep's
 * under-lock re-check). `rowsAtRecheck`, when given, is what the sheet
 * looks like by the time of that re-check - i.e. staff changed it
 * mid-sweep.
 */
function mockBidderNumbers(rows: any[][], rowsAtRecheck?: any[][]) {
  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
      const url = new URL(request.url);
      const range = decodeURIComponent(url.pathname.split("/").pop() || "");
      if (!range.includes("Bidder-Numbers")) return HttpResponse.json({ values: [] });
      const singleRow = range.match(/!A(\d+):L\1$/);
      if (singleRow) {
        const all = [HEADER, ...(rowsAtRecheck ?? rows)];
        return HttpResponse.json({ values: [all[Number(singleRow[1]) - 1] ?? []] });
      }
      return HttpResponse.json({ values: [HEADER, ...rows] });
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHandlersState();
  capturedSets.length = 0;
  sweeperDoc = { refreshToken: "sweeper-refresh-token" };
  configDoc = { bidManagementSpreadsheetId: "bm-id", bidderNumbersSheet: "Bidder-Numbers", paypalIsSandbox: true };
});

describe("persistSweeperCredential", () => {
  it("writes the refresh token to system/paypalSweeperAuth", async () => {
    await persistSweeperCredential("new-refresh-token", "staff@orns.org");
    expect(capturedSets).toEqual([
      { collection: "system", doc: "paypalSweeperAuth", data: expect.objectContaining({ refreshToken: "new-refresh-token", updatedBy: "staff@orns.org" }) },
    ]);
  });
});

describe("runPaypalSweep - skip conditions", () => {
  it("skips when no background-sync credential is stored yet", async () => {
    sweeperDoc = {};
    const result = await runPaypalSweep();
    expect(result).toEqual({ skipped: expect.stringContaining("No background-sync credential") });
  });

  it("skips when no bidManagementSpreadsheetId is configured yet", async () => {
    configDoc = {};
    const result = await runPaypalSweep();
    expect(result).toEqual({ skipped: expect.stringContaining("No bidManagementSpreadsheetId") });
  });
});

describe("runPaypalSweep - resolving/escalating pending rows", () => {
  it("resolves a row PayPal now shows as PAID", async () => {
    mockBidderNumbers([pendingRow()]);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("PAID");

    let capturedUpdates: { range: string; values: any[][] }[] = [];
    server.use(
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ params, request }) => {
        const body = await request.clone().json() as any;
        capturedUpdates.push({ range: decodeURIComponent(String(params.range)), values: body.values });
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const result = await runPaypalSweep();

    expect(result).toEqual({ pending: 1, resolved: 1, escalated: 0 });
    const giUpdate = capturedUpdates.find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[true, true, "Credit Card / PayPal"]]);
    const lUpdate = capturedUpdates.find((u) => u.range.includes("L2"));
    expect(lUpdate?.values).toEqual([[""]]);
  });

  it("also resolves a MARKED_AS_PAID row", async () => {
    mockBidderNumbers([pendingRow()]);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("MARKED_AS_PAID");

    const result = await runPaypalSweep();
    expect(result).toEqual({ pending: 1, resolved: 1, escalated: 0 });
  });

  it("escalates to PayPal-Follow-Up (not the client-facing 3-column Follow-Up sheet) once the row has been pending longer than 10 minutes", async () => {
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    mockBidderNumbers([pendingRow({ 11: elevenMinutesAgo })]);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("SENT");

    let capturedUpdates: { range: string; values: any[][] }[] = [];
    let capturedAppend: any = null;
    let capturedAppendRange: string | null = null;
    server.use(
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ params, request }) => {
        const body = await request.clone().json() as any;
        capturedUpdates.push({ range: decodeURIComponent(String(params.range)), values: body.values });
        return HttpResponse.json({ updatedRows: 1 });
      }),
      http.post("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range\\:append", async ({ params, request }) => {
        capturedAppendRange = decodeURIComponent(String(params.range));
        capturedAppend = await request.clone().json();
        return HttpResponse.json({ updates: { updatedRows: 1 } });
      })
    );

    const result = await runPaypalSweep();

    expect(result).toEqual({ pending: 1, resolved: 0, escalated: 1 });
    // Real-bug regression guard: this must land on the sweeper's own
    // "PayPal-Follow-Up" sheet, never the client-facing "Follow-Up" sheet
    // (auctionService.ts's recordWinningBidLocked / Dashboard's
    // Post-Checkout Item Wins panel) - the two used to collide on the same
    // sheet name with incompatible schemas. See
    // docs/agents/refactor-opportunities.md's Code Hardening item #1 /
    // CHANGELOG.md.
    expect(capturedAppendRange).toBe("PayPal-Follow-Up!A:F");
    const [, appendedBidderId, appendedName, appendedAmount, appendedUrl] = capturedAppend.values[0];
    expect(appendedBidderId).toBe("101");
    expect(appendedName).toBe("Jane Doe");
    expect(appendedAmount).toBe(104.12);
    expect(appendedUrl).toBe("https://www.paypal.com/invoice/p/#INV2-X");
    const giUpdate = capturedUpdates.find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[false, false, "Failed Verification - Follow Up Required"]]);
    const lUpdate = capturedUpdates.find((u) => u.range.includes("L2"));
    expect(lUpdate?.values).toEqual([[""]]);
  });

  it("seeds a missing/invalid timestamp instead of escalating immediately", async () => {
    mockBidderNumbers([pendingRow({ 11: "" })]);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("SENT");

    let capturedUpdates: { range: string; values: any[][] }[] = [];
    server.use(
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ params, request }) => {
        const body = await request.clone().json() as any;
        capturedUpdates.push({ range: decodeURIComponent(String(params.range)), values: body.values });
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const result = await runPaypalSweep();

    expect(result).toEqual({ pending: 1, resolved: 0, escalated: 0 });
    const lUpdate = capturedUpdates.find((u) => u.range.includes("L2"));
    expect(typeof lUpdate?.values[0][0]).toBe("string");
    expect(lUpdate?.values[0][0]).not.toBe("");
  });

  it("skips a row with no evaluable invoice ID without throwing", async () => {
    mockBidderNumbers([pendingRow()]);
    mockExtractInvoiceIdFromUrl.mockReturnValue(null);

    const result = await runPaypalSweep();

    expect(result).toEqual({ pending: 1, resolved: 0, escalated: 0 });
    expect(mockGetInvoiceStatus).not.toHaveBeenCalled();
  });

  it("does not abort the whole sweep when one row's getInvoiceStatus throws", async () => {
    mockBidderNumbers([
      pendingRow({ 0: "101" }),
      pendingRow({ 0: "102" }),
    ]);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus
      .mockRejectedValueOnce(new Error("PayPal Live Lookup Failed (500)"))
      .mockResolvedValueOnce("PAID");

    const result = await runPaypalSweep();

    // Evaluated bottom-up: row 2 (bidder 102) resolves; row 1 (bidder 101)
    // throws and is skipped, but doesn't abort row 2's own processing.
    expect(result).toEqual({ pending: 2, resolved: 1, escalated: 0 });
  });

  it("ignores rows whose method label isn't the pending marker", async () => {
    mockBidderNumbers([pendingRow({ 8: "Cash" })]);
    const result = await runPaypalSweep();
    expect(result).toEqual({ pending: 0, resolved: 0, escalated: 0 });
    expect(mockExtractInvoiceIdFromUrl).not.toHaveBeenCalled();
  });

  it("constructs PayPalService with the configured sandbox flag", async () => {
    configDoc.paypalIsSandbox = false;
    mockBidderNumbers([]);
    await runPaypalSweep();
    expect(lastPayPalServiceCtorArgs).toEqual({ isSandbox: false });
  });
});

describe("runPaypalSweep - never overwrites a row staff changed mid-sweep (ROADMAP.md H5)", () => {
  function captureWrites() {
    const writes: string[] = [];
    server.use(
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ params }) => {
        writes.push(decodeURIComponent(String(params.range)));
        return HttpResponse.json({ updatedRows: 1 });
      }),
      http.post("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range\\:append", ({ params }) => {
        writes.push(`append:${decodeURIComponent(String(params.range))}`);
        return HttpResponse.json({ updates: {} });
      })
    );
    return writes;
  }

  it("leaves a timed-out row alone if staff marked it Cash after the sweep's snapshot", async () => {
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    mockBidderNumbers(
      [pendingRow({ 11: elevenMinutesAgo })],
      [pendingRow({ 6: true, 7: true, 8: "Cash", 11: "" })]
    );
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("SENT");
    const writes = captureWrites();

    const result = await runPaypalSweep();

    expect(result).toEqual({ pending: 1, resolved: 0, escalated: 0 });
    expect(writes).toEqual([]);
  });

  it("leaves a row alone if checkout re-ran on a new invoice after the snapshot", async () => {
    mockBidderNumbers(
      [pendingRow()],
      [pendingRow({ 9: "https://www.paypal.com/invoice/p/#INV2-NEW" })]
    );
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("PAID");
    const writes = captureWrites();

    const result = await runPaypalSweep();

    expect(result).toEqual({ pending: 1, resolved: 0, escalated: 0 });
    expect(writes).toEqual([]);
  });

  it("waits for the bidder-numbers lock before writing, so it can't interleave with checkout", async () => {
    const { withLock } = await import("../utils/asyncLock");
    mockBidderNumbers([pendingRow()]);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("PAID");
    const writes = captureWrites();

    // Stand-in for a checkout holding the lock on the same spreadsheet.
    let releaseCheckout!: () => void;
    const checkoutHolding = withLock("bidder-numbers:bm-id", () => new Promise<void>((resolve) => { releaseCheckout = resolve; }));

    const sweep = runPaypalSweep();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes).toEqual([]);

    releaseCheckout();
    await checkoutHolding;
    expect(await sweep).toEqual({ pending: 1, resolved: 1, escalated: 0 });
    expect(writes.length).toBeGreaterThan(0);
  });
});

// Drives the Configuration page's sweeper status card - see
// docs/agents/refactor-opportunities.md's Code Hardening item #2 and
// CHANGELOG.md.
describe("getSweeperStatus", () => {
  it("reports the credential as not configured when no refresh token is stored", async () => {
    sweeperDoc = {};
    const status = await getSweeperStatus();
    expect(status.credentialConfigured).toBe(false);
    expect(status.credentialUpdatedBy).toBeNull();
    expect(status.credentialUpdatedAt).toBeNull();
  });

  it("reports the credential as configured with who/when it was last set", async () => {
    sweeperDoc = { refreshToken: "tok", updatedBy: "staff@orns.org", updatedAt: "2026-01-01T00:00:00.000Z" };
    const status = await getSweeperStatus();
    expect(status.credentialConfigured).toBe(true);
    expect(status.credentialUpdatedBy).toBe("staff@orns.org");
    expect(status.credentialUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("records a completed run's outcome", async () => {
    mockBidderNumbers([]);
    const beforeRun = Date.now();

    const result = await runPaypalSweep();
    const status = await getSweeperStatus();

    expect(status.lastResult).toEqual(result);
    expect(new Date(status.lastRunAt!).getTime()).toBeGreaterThanOrEqual(beforeRun);
  });

  it("marks the schedule active only after a Cloud Scheduler run, and persists that time", async () => {
    mockBidderNumbers([]);
    await runPaypalSweep("manual");
    const scheduledSetsBefore = capturedSets.filter((c) => c.data.scheduledAt).length;
    expect(scheduledSetsBefore).toBe(0);

    await runPaypalSweep("scheduler");
    const status = await getSweeperStatus();
    expect(status.scheduleActive).toBe(true);
    expect(status.lastScheduledRunAt).not.toBeNull();
    expect(capturedSets.some((c) => c.doc === "paypalSweeperStatus" && c.data.scheduledAt)).toBe(true);
  });

  it("runs one sweep at a time - a second call while one is running shares its result", async () => {
    mockBidderNumbers([]);
    const [a, b] = await Promise.all([runPaypalSweep("scheduler"), runPaypalSweep("manual")]);
    expect(a).toBe(b);
  });
});
