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
const mockRemoveSurchargeLine = vi.fn();
const mockGetInvoiceStatus = vi.fn();

vi.mock("../services/paypalService", async (importOriginal) => ({
  isPaidInvoiceStatus: (await importOriginal<typeof import("../services/paypalService")>()).isPaidInvoiceStatus,
  // A regular function, not an arrow function - arrow functions can't be
  // used as a `new`-constructor, which is exactly how auctionService.ts
  // instantiates this (`new PayPalService(...)`).
  PayPalService: vi.fn().mockImplementation(function () {
    return {
      extractInvoiceIdFromUrl: mockExtractInvoiceIdFromUrl,
      recordOfflinePayment: mockRecordOfflinePayment,
      removeSurchargeLine: mockRemoveSurchargeLine,
      getInvoiceStatus: mockGetInvoiceStatus,
    };
  }),
}));

// Mocked wholesale, matching the PayPalService mock above - this test
// suite is only responsible for checkoutMarkPaid's own orchestration
// (does it call this when there's no existing invoice, does it surface
// a failure correctly), not receiptDataService's own invoice-creation
// logic, which has its own coverage.
const mockBuildBidderReceiptWithInvoice = vi.fn();
vi.mock("../services/receiptDataService", async (importOriginal) => ({
  DEFAULT_SHEET_NAMES: (await importOriginal<typeof import("../services/receiptDataService")>()).DEFAULT_SHEET_NAMES,
  buildBidderReceiptWithInvoice: (...args: any[]) => mockBuildBidderReceiptWithInvoice(...args),
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
    itemsSpreadsheetId: "items-id",
    bidderNumbersSheet: "Bidder-Numbers",
    paymentMethod: "cash",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHandlersState();
  // By default the surcharge comes off cleanly; individual tests override.
  mockRemoveSurchargeLine.mockReset();
  mockRemoveSurchargeLine.mockImplementation(async () => ({ status: "UNPAID", total: 100, removed: true }));
});

describe("checkoutMarkPaid - offline payment methods (cash/check)", () => {
  it("marks the bidder paid/checked-out, takes the surcharge off the invoice, and records the cash at the fee-free total (ROADMAP.md L3)", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-AAAA-BBBB-CCCC-DDDD", 10: 104.12 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-AAAA-BBBB-CCCC-DDDD");
    mockRecordOfflinePayment.mockResolvedValue(true);

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "cash" }));

    expect(result.success).toBe(true);
    expect(result.deferred).toBeFalsy();
    expect(result.warning).toBeUndefined();
    expect(mockRemoveSurchargeLine).toHaveBeenCalledWith("INV2-AAAA-BBBB-CCCC-DDDD");
    expect(mockRecordOfflinePayment).toHaveBeenCalledWith("INV2-AAAA-BBBB-CCCC-DDDD", "Cash", 100);
    // Column K is left alone, so a later receipt run still reuses this invoice.
    expect(getUpdates().some((u) => u.range.includes("K2"))).toBe(false);

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

    expect(mockRecordOfflinePayment).toHaveBeenCalledWith("INV2-X", "Check", 100);
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[true, true, "Check"]]);
  });

  it("still marks the bidder paid if the PayPal-side recording throws, and warns staff the invoice is still open (ROADMAP.md L3)", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 50 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockRecordOfflinePayment.mockRejectedValue(new Error("PayPal API down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "cash" }));

    expect(result.success).toBe(true);
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[true, true, "Cash"]]);
    expect(result.warning).toMatch(/INV2-X.*can still be paid online/);
  });

  it("warns staff when PayPal answers but doesn't accept the recorded payment (recordOfflinePayment returns false)", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 50 });
    mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockRecordOfflinePayment.mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "check" }));

    expect(result.success).toBe(true);
    expect(result.warning).toMatch(/marked paid \(Check\).*Mark it paid in the PayPal dashboard/);
  });

  it("falls back to recording the full invoice amount when the surcharge can't be removed", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 });
    mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockRemoveSurchargeLine.mockRejectedValue(new Error("PayPal invoice update failed (422)"));
    mockRecordOfflinePayment.mockResolvedValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "cash" }));

    expect(result.success).toBe(true);
    expect(mockRecordOfflinePayment).toHaveBeenCalledWith("INV2-X", "Cash", 104.12);
    expect(result.warning).toBeUndefined();
  });

  it("doesn't record cash on an invoice PayPal shows as already paid, and warns about a possible double payment", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockRemoveSurchargeLine.mockResolvedValue({ status: "PAID", total: 104.12, removed: false });

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "cash" }));

    expect(result.success).toBe(true);
    expect(mockRecordOfflinePayment).not.toHaveBeenCalled();
    expect(result.warning).toMatch(/already paid \(PAID\).*double payment/);
    expect(getUpdates().find((u) => u.range.includes("G2:I2"))?.values).toEqual([[true, true, "Cash"]]);
  });

  it("gives no warning when PayPal records the payment", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 50 });
    mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockRecordOfflinePayment.mockResolvedValue(true);

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "cash" }));

    expect(result.warning).toBeUndefined();
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

  it("also marks paid immediately for MARKED_AS_PAID, as the sweeper does (ROADMAP.md L2)", async () => {
    const row = makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 });
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue("INV2-X");
    mockGetInvoiceStatus.mockResolvedValue("MARKED_AS_PAID");

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "credit_card" }));

    expect(result.deferred).toBeFalsy();
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[true, true, "Credit Card / PayPal"]]);
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

  it("creates a fresh PayPal invoice (instead of just deferring) when there's no invoice ID to check - the real user-reported bug", async () => {
    // Before this fix, a bidder who never had their receipt generated/
    // printed (the only path that previously created a PayPal invoice)
    // would check out via Credit Card/PayPal straight into "PayPal
    // Verification Pending" with no invoice ever created anywhere - the
    // customer had nothing to pay, and paypalSweeperJob.ts had nothing
    // to resolve. See docs/agents/CHANGELOG.md's "PayPal Integration
    // Issue" fix.
    const row = makeBidderRow(); // no invoice URL
    const { getUpdates } = mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue(null);
    mockBuildBidderReceiptWithInvoice.mockResolvedValue({
      success: true,
      receipt: { paymentUrl: "https://www.paypal.com/invoice/p/#INV2-NEW", adjustedTotal: 104.12 },
    });

    const result = await checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "credit_card" }));

    expect(mockGetInvoiceStatus).not.toHaveBeenCalled();
    // With the configured tab names (ROADMAP.md L1) - Bid-Management falls back to its default when the request didn't send one.
    expect(mockBuildBidderReceiptWithInvoice).toHaveBeenCalledWith(fakeClient, "bm-id", "items-id", "101", expect.anything(), {
      bidderNumbers: "Bidder-Numbers",
      bidManagement: "Bid-Management",
    });
    expect(result.deferred).toBe(true);
    const giUpdate = getUpdates().find((u) => u.range.includes("G2:I2"));
    expect(giUpdate?.values).toEqual([[false, false, "PayPal Verification Pending"]]);
  });

  it("surfaces a clear error instead of checking out when there's no itemsSpreadsheetId to create an invoice with", async () => {
    const row = makeBidderRow(); // no invoice URL
    mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue(null);

    await expect(
      checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "credit_card", itemsSpreadsheetId: undefined }))
    ).rejects.toThrow(/Auction Items Spreadsheet ID is required/);
    expect(mockBuildBidderReceiptWithInvoice).not.toHaveBeenCalled();
  });

  it("surfaces the underlying error when invoice creation itself fails", async () => {
    const row = makeBidderRow(); // no invoice URL
    mockBidderNumbers(row);
    mockExtractInvoiceIdFromUrl.mockReturnValue(null);
    mockBuildBidderReceiptWithInvoice.mockResolvedValue({
      success: false,
      error: "Bidder ID 101 not found in the Auction-Items bid grid.",
    });

    await expect(
      checkoutMarkPaid(fakeClient, baseParams({ paymentMethod: "credit_card" }))
    ).rejects.toThrow(/Bidder ID 101 not found in the Auction-Items bid grid/);
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
