/**
 * Tests server/services/paypalSweeperJob.ts - the Node port of
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/PayPalSweeper.gs's
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

vi.mock("../services/paypalService", () => ({
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

import { runPaypalSweep, persistSweeperCredential, getSweeperStatus, startPaypalSweeperSchedule } from "../services/paypalSweeperJob";

const HEADER = ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid", "Method", "InvoiceURL", "Amount", "Timestamp"];

function pendingRow(overrides: Record<number, any> = {}) {
  const row: any[] = ["101", "Jane", "Doe", "jane@example.com", true, false, false, false, "PayPal Verification Pending", "https://www.paypal.com/invoice/p/#INV2-X", 104.12, new Date().toISOString()];
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

function mockBidderNumbers(rows: any[][]) {
  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.includes("Bidder-Numbers")) return HttpResponse.json({ values: [HEADER, ...rows] });
      return HttpResponse.json({ values: [] });
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

  it("records a completed run's outcome and computes nextRunAt one interval past it", async () => {
    mockBidderNumbers([]);
    const beforeRun = Date.now();

    const result = await runPaypalSweep();
    const status = await getSweeperStatus();

    expect(status.lastResult).toEqual(result);
    expect(status.lastRunAt).not.toBeNull();
    expect(new Date(status.lastRunAt!).getTime()).toBeGreaterThanOrEqual(beforeRun);

    const lastRunMs = new Date(status.lastRunAt!).getTime();
    const nextRunMs = new Date(status.nextRunAt!).getTime();
    expect(nextRunMs - lastRunMs).toBe(status.intervalMinutes * 60 * 1000);
  });

  it("starts no timer when PAYPAL_SWEEPER_INTERVAL_MINUTES is 0 (local development)", () => {
    const original = process.env.PAYPAL_SWEEPER_INTERVAL_MINUTES;
    process.env.PAYPAL_SWEEPER_INTERVAL_MINUTES = "0";
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      expect(startPaypalSweeperSchedule()).toBeNull();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
      if (original === undefined) delete process.env.PAYPAL_SWEEPER_INTERVAL_MINUTES;
      else process.env.PAYPAL_SWEEPER_INTERVAL_MINUTES = original;
    }
  });

  it("reports scheduleRunning once startPaypalSweeperSchedule has been called", async () => {
    const timer = startPaypalSweeperSchedule();
    try {
      const status = await getSweeperStatus();
      expect(status.scheduleRunning).toBe(true);
    } finally {
      if (timer) clearInterval(timer);
    }
  });
});
