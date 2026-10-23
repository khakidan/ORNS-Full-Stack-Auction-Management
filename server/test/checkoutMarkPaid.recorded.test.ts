/**
 * Records every Google Sheets request and PayPal call checkoutMarkPaid
 * makes in its main scenarios (ROADMAP.md R11), so it can be restructured
 * without changing what it writes. PayPal is mocked as in
 * checkoutMarkPaid.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { getAuthenticatedClient } from "../services/oauth";

const paypal = {
  extractInvoiceIdFromUrl: vi.fn(),
  recordOfflinePayment: vi.fn(),
  removeSurchargeLine: vi.fn(),
  getInvoiceStatus: vi.fn(),
};
vi.mock("../services/paypalService", async (importOriginal) => ({
  isPaidInvoiceStatus: (await importOriginal<typeof import("../services/paypalService")>()).isPaidInvoiceStatus,
  PayPalService: vi.fn().mockImplementation(function () { return paypal; }),
}));
const mockBuildBidderReceiptWithInvoice = vi.fn();
vi.mock("../services/receiptDataService", async (importOriginal) => ({
  DEFAULT_SHEET_NAMES: (await importOriginal<typeof import("../services/receiptDataService")>()).DEFAULT_SHEET_NAMES,
  buildBidderReceiptWithInvoice: (...args: any[]) => mockBuildBidderReceiptWithInvoice(...args),
}));

import { checkoutMarkPaid } from "../services/auctionService";

const client = getAuthenticatedClient({ access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 });
const HEADER = ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid", "Method", "InvoiceURL", "Amount", "PendingSince"];

let log: any[] = [];
function serve(row: any[]) {
  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", ({ params }) => {
      const range = decodeURIComponent(String(params.range));
      log.push(["get", params.id, range]);
      if (range.includes("Bidder-Numbers") && range.includes("A:L")) return HttpResponse.json({ values: [HEADER, ["100"], row] });
      return HttpResponse.json({ values: [] });
    }),
    http.put("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", async ({ params, request }) => {
      const body = await request.json() as any;
      log.push(["update", params.id, decodeURIComponent(String(params.range)), body.values]);
      return HttpResponse.json({});
    })
  );
}
const params = (overrides: Record<string, any>) => ({
  bidderId: "101", spreadsheetId: "bm", itemsSpreadsheetId: "items", bidderNumbersSheet: "Bidder-Numbers", paymentMethod: "cash", ...overrides,
});
const paypalCalls = () => Object.fromEntries(Object.entries(paypal).map(([k, fn]) => [k, fn.mock.calls]));

beforeEach(() => {
  log = [];
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-24T20:15:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("checkoutMarkPaid - recorded calls", () => {
  it("cash with an invoice: marks paid, takes the fee off, records the cash on PayPal, updates the ticket sheet", async () => {
    serve(["101", "Jane", "Doe", "", true, false, false, false, "", "https://paypal/#INV-1", 104.12, ""]);
    paypal.extractInvoiceIdFromUrl.mockReturnValue("INV-1");
    paypal.removeSurchargeLine.mockResolvedValue({ status: "UNPAID", total: 100 });
    paypal.recordOfflinePayment.mockResolvedValue(true);

    const result = await checkoutMarkPaid(client, params({ ticketsSpreadsheetId: "tix", attendeeInfo: { sheet: "tickets", rowIndex: 7 } }));
    expect({ result, log, paypal: paypalCalls() }).toMatchSnapshot();
  });

  it("check whose PayPal invoice was already paid online: marks paid and warns", async () => {
    serve(["101", "Jane", "Doe", "", true, false, false, false, "", "https://paypal/#INV-2", 50, ""]);
    paypal.extractInvoiceIdFromUrl.mockReturnValue("INV-2");
    paypal.removeSurchargeLine.mockResolvedValue({ status: "PAID", total: 50 });

    const result = await checkoutMarkPaid(client, params({ paymentMethod: "check" }));
    expect({ result, log, paypal: paypalCalls() }).toMatchSnapshot();
  });

  it("card already paid on PayPal: marks paid", async () => {
    serve(["101", "Jane", "Doe", "", true, false, false, false, "", "https://paypal/#INV-3", 50, ""]);
    paypal.extractInvoiceIdFromUrl.mockReturnValue("INV-3");
    paypal.getInvoiceStatus.mockResolvedValue("PAID");

    const result = await checkoutMarkPaid(client, params({ paymentMethod: "credit_card" }));
    expect({ result, log, paypal: paypalCalls() }).toMatchSnapshot();
  });

  it("card with no invoice yet: creates one, then defers to PayPal Verification Pending", async () => {
    serve(["101", "Jane", "Doe", "", true, false, false, false, "", "", "", ""]);
    paypal.extractInvoiceIdFromUrl.mockReturnValue(null);
    mockBuildBidderReceiptWithInvoice.mockResolvedValue({ success: true });

    const result = await checkoutMarkPaid(client, params({ paymentMethod: "credit_card" }));
    expect({ result, log, paypal: paypalCalls(), invoiceBuilds: mockBuildBidderReceiptWithInvoice.mock.calls.map((c) => c.slice(1, 4)) }).toMatchSnapshot();
  });
});
