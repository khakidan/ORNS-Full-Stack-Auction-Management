/**
 * Tests server/services/auctionService.ts's checkoutMarkPaid payment-
 * recording logic - ported from
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GoogleAIStudio.gs's
 * (now-deleted) `recordPayment`/`apiRecordPayment` bridge. Mirrors
 * the deleted server/test/gs-google-ai-studio.test.ts's scenarios
 * exactly, since that file tested the GAS source this replaces. See
 * docs/agents/refactor-opportunities.md's Code Hardening item #2, Step 3
 * / CHANGELOG.md.
 *
 * PayPalService itself is fully mocked here (not exercised over the
 * network/MSW) so assertions can pin exact call arguments the same way
 * the deleted GAS test did with its injected fake `paypalService`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState } from "./handlers";
import { getAuthenticatedClient } from "../services/oauth";

const mockExtractInvoiceIdFromUrl = vi.fn();
const mockRecordOfflinePayment = vi.fn();
const mockGetInvoiceStatus = vi.fn();

vi.mock("../services/paypalService", () => ({
  // A regular function, not an arrow function - arrow functions can't be
  // used as a `new`-constructor, which is exactly how auctionService.ts
  // instantiates this (`new PayPalService(...)`).
  PayPalService: vi.fn().mockImplementation(function () {
    return {
      extractInvoiceIdFromUrl: mockExtractInvoiceIdFromUrl,
      recordOfflinePayment: mockRecordOfflinePayment,
      getInvoiceStatus: mockGetInvoiceStatus,
    };
  }),
}));

import { checkoutMarkPaid } from "../services/auctionService";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000,
};
const fakeClient = getAuthenticatedClient(mockTokens);

// Column layout of a Bidder-Numbers row (0-indexed): A id, B firstName,
// C lastName, D email, E checkedIn, F proxy, G checkedOut, H paid,
// I methodLabel, J invoiceUrl, K invoicedAmount, L timestamp.
const HEADER = ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid", "Method", "InvoiceURL", "Amount", "Timestamp"];

function makeBidderRow(overrides: Record<number, any> = {}) {
  const row: any[] = ["101", "Jane", "Doe", "jane@example.com", true, false, false, false, "", "", 0, ""];
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

function mockBidderNumbers(row: any[]) {
  let capturedUpdates: { range: string; values: any[][] }[] = [];
  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.includes("Bidder-Numbers")) return HttpResponse.json({ values: [HEADER, row] });
      return HttpResponse.json({ values: [] });
    }),
    http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ params, request }) => {
      const body = await request.clone().json() as any;
      capturedUpdates.push({ range: decodeURIComponent(String(params.range)), values: body.values });
      return HttpResponse.json({ updatedRows: 1 });
    })
  );
  return { getUpdates: () => capturedUpdates };
}

function baseParams(overrides: Record<string, any> = {}) {
  return {
    bidderId: "101",
    spreadsheetId: "bm-id",
    bidderNumbersSheet: "Bidder-Numbers",
    paymentMethod: "cash",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHandlersState();
});

describe("checkoutMarkPaid - offline payment methods (cash/check)", () => {
  it("marks the bidder paid/checked-out and records the offline payment on PayPal", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-AAAA-BBBB-CCCC-DDDD", 10: 104.12 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-AAAA-BBBB-CCCC-DDDD");
    mockRecordOfflinePayment.mockResolvedValue(true);

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "cash" }));

    expect(result.success).toBe(true);
    expect(result.deferred).toBeFalsy();
    expect(mockRecordOfflinePayment).toHaveBeenCalledWith("INV2-AAAA-BBBB-CCCC-DDDD", "Cash", 104.12);

    const updates = getUpdates();
    const giUpdate = updates.find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[true, true, "Cash"]]);
    const lUpdate = updates.find((u) => u.range.includes("L2"));
    expect(lUpdate?.values).toEqual([[""]]);
  });

  it("uses the 'Check' label for check payments", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 50 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockRecordOfflinePayment.mockResolvedValue(true);

    await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "check" }));

    expect(mockRecordOfflinePayment).toHaveBeenCalledWith("INV2-X", "Check", 50);
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[true, true, "Check"]]);
  });

  it("still marks the bidder paid even if the PayPal-side recording throws", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 50 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockRecordOfflinePayment.mockRejectedValue(new Error("PayPal API down"));

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "cash" }));

    expect(result.success).toBe(true);
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[true, true, "Cash"]]);
  });

  it("skips the PayPal call entirely when there's no invoice ID", async () => {
    const row = makeBidderRow(); // no invoice URL
    mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue(null);

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "cash" }));

    expect(result.success).toBe(true);
    expect(mockRecordOfflinePayment).not.toHaveBeenCalled();
  });
});

describe("checkoutMarkPaid - credit_card (live PayPal gate)", () => {
  it("marks paid immediately when PayPal already shows the invoice as PAID", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("PAID");

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "credit_card" }));

    expect(result.success).toBe(true);
    expect(result.deferred).toBeFalsy();
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[true, true, "Credit Card / PayPal"]]);
    const lUpdate = getUpdates().find((u) => u.range.includes("L2"));
    expect(lUpdate?.values).toEqual([[""]]);
  });

  it("defers to the background sweeper when PayPal doesn't show the invoice as paid yet", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("SENT");

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "credit_card" }));

    expect(result.success).toBe(true);
    expect(result.deferred).toBe(true);
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[false, false, "PayPal Verification Pending"]]);
    const lUpdate = getUpdates().find((u) => u.range.includes("L2"));
    expect(typeof lUpdate?.values[0][0]).toBe("string");
    expect(lUpdate?.values[0][0]).not.toBe("");
  });

  it("defers without calling getInvoiceStatus when there's no invoice ID to check", async () => {
    const row = makeBidderRow(); // no invoice URL
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue(null);

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "credit_card" }));

    expect(mockGetInvoiceStatus).not.toHaveBeenCalled();
    expect(result.deferred).toBe(true);
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[false, false, "PayPal Verification Pending"]]);
  });

  it("wraps a getInvoiceStatus failure into a 'Credit Card validation processing error'", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 });
    mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockRejectedValue(new Error("PayPal Live Lookup Failed (404): not found"));

    await expect(checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "credit_card" }))).rejects.toThrow(
      /Credit Card validation processing error/
    );
  });
});

describe("checkoutMarkPaid - error paths", () => {
  it("throws a not-found error when the bidder ID isn't in the sheet", async () => {
    mockBidderNumbers(makeBidderRow({ 0: "101" }));
    await expect(checkoutMarkPaid(fakeClient, baseParams({ bidderId: "999" }))).rejects.toThrow(/Bidder ID not found/);
  });

  it("throws for an unrecognized payment method", async () => {
    mockBidderNumbers(makeBidderRow());
    mockExtractInvoiceIdFromUrl.mockReturnValue(null);
    await expect(checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "PAYPAL" }))).rejects.toThrow(
      /Unknown checkout payment method specified: PAYPAL/
    );
  });
});
