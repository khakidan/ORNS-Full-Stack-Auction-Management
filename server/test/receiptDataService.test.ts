/**
 * Tests server/services/receiptDataService.ts - the single shared
 * implementation of "resolve a bidder's winning items and total" that
 * replaced the duplicate logic previously hand-written twice: once in
 * emailService.ts (for the emailed receipt - see emailService.test.ts,
 * unaffected by this refactor) and once in
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_ReceiptManager.gs's
 * `findBidderColInBidSheet_`/`buildReceipt_` (for the printed/PDF receipt
 * and PayPal invoice, now removed - see refactor-opportunities.md's Code
 * Hardening item #2 / CHANGELOG.md).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAuthenticatedClient } from "../services/oauth";
import { resetHandlersState } from "./handlers";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import {
  buildBidderReceipt,
  buildAllBidderReceipts,
  findBidderColumn,
  buildItemNameLookup,
  resolveWonItems,
  findExistingInvoice,
  resolveInvoiceUrl,
  buildBidderReceiptWithInvoice,
  buildAllBidderReceiptsWithInvoices,
} from "../services/receiptDataService";
import { PayPalService } from "../services/paypalService";
import { calculatePayPalSurcharge } from "../utils/financeUtils";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000,
};
const fakeClient = getAuthenticatedClient(mockTokens);

const BID_MANAGEMENT_ROWS = [
  ["101", "", "102", ""],
  ["filler", "filler", "filler", "filler"],
  ["filler", "filler", "filler", "filler"],
  ["801", "50", "803", "25"],
];

const BIDDER_NUMBERS_ROWS = [
  ["ID", "First Name", "Last Name", "Email"],
  ["101", "Alice", "One", "alice@example.com"],
  ["102", "Zed", "Last", "zed@example.com"],
];

const AUCTION_ITEMS_ROWS = [
  ["Item Number", "Category", "Item Name"],
  ["801", "Food", "Pizza Night"],
  ["803", "Food", "Sushi Dinner"],
];

function mockSheets(overrides: { bidManagement?: any[][]; bidderNumbers?: any[][]; auctionItems?: any[][] } = {}) {
  const bidManagement = overrides.bidManagement ?? BID_MANAGEMENT_ROWS;
  const bidderNumbers = overrides.bidderNumbers ?? BIDDER_NUMBERS_ROWS;
  const auctionItems = overrides.auctionItems ?? AUCTION_ITEMS_ROWS;

  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
      const url = new URL(request.url);
      if (url.pathname.includes("Bid-Management")) return HttpResponse.json({ values: bidManagement });
      if (url.pathname.includes("Bidder-Numbers")) return HttpResponse.json({ values: bidderNumbers });
      if (url.pathname.includes("Auction-Items")) return HttpResponse.json({ values: auctionItems });
      return HttpResponse.json({ values: [] });
    })
  );
}

describe("resolveWonItems / findBidderColumn / buildItemNameLookup (pure helpers)", () => {
  it("findBidderColumn finds a bidder's column, scanning header pairs", () => {
    expect(findBidderColumn(BID_MANAGEMENT_ROWS, "101")).toBe(0);
    expect(findBidderColumn(BID_MANAGEMENT_ROWS, "102")).toBe(2);
    expect(findBidderColumn(BID_MANAGEMENT_ROWS, "999")).toBe(-1);
  });

  it("resolveWonItems reads rows 3+ for the given column, resolving names via the lookup", () => {
    const getItemName = buildItemNameLookup(AUCTION_ITEMS_ROWS);

    expect(resolveWonItems(BID_MANAGEMENT_ROWS, 0, getItemName)).toEqual({
      itemsWon: ["801"],
      itemNames: ["Pizza Night"],
      itemPrices: [50],
      totalCost: 50,
    });
    // A second bidder's column (2) in the same row must resolve
    // independently, not bleed into the first bidder's items.
    expect(resolveWonItems(BID_MANAGEMENT_ROWS, 2, getItemName)).toEqual({
      itemsWon: ["803"],
      itemNames: ["Sushi Dinner"],
      itemPrices: [25],
      totalCost: 25,
    });
  });

  it("buildItemNameLookup falls back to 'Unknown Item' for an unmatched ID", () => {
    const getItemName = buildItemNameLookup(AUCTION_ITEMS_ROWS);
    expect(getItemName("9999")).toBe("Unknown Item");
  });
});

describe("buildBidderReceipt", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("resolves a full receipt for a bidder with winning items", async () => {
    mockSheets();

    const result = await buildBidderReceipt(fakeClient, "bm-id", "items-id", "101");

    expect(result).toEqual({
      success: true,
      receipt: {
        bidId: "101",
        firstName: "Alice",
        lastName: "One",
        email: "alice@example.com",
        itemsWon: ["801"],
        itemNames: ["Pizza Night"],
        itemPrices: [50],
        totalCost: 50,
      },
    });
  });

  it("returns a clean error when the bidder isn't in Bidder-Numbers", async () => {
    mockSheets();
    const result = await buildBidderReceipt(fakeClient, "bm-id", "items-id", "999");
    expect(result).toEqual({ success: false, error: "Bidder ID 999 not found in the Bidder-Numbers sheet." });
  });

  it("returns a clean error when the bidder isn't in the Bid-Management matrix", async () => {
    mockSheets({ bidManagement: [["999", "", "", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]] });
    const result = await buildBidderReceipt(fakeClient, "bm-id", "items-id", "101");
    expect(result).toEqual({ success: false, error: "Bidder ID not found in matrix." });
  });

  it("returns a clean error when the bidder won no items", async () => {
    mockSheets({ bidManagement: [["101", "", "", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]] });
    const result = await buildBidderReceipt(fakeClient, "bm-id", "items-id", "101");
    expect(result).toEqual({ success: false, error: "No items won." });
  });
});

describe("buildAllBidderReceipts", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("builds every bidder's receipt, sorted ascending by last name", async () => {
    mockSheets();

    const receipts = await buildAllBidderReceipts(fakeClient, "bm-id", "items-id");

    // Sorted by last name, not first name or column order - "Last" < "One"
    // alphabetically, so Zed Last comes first despite the first name "Zed".
    expect(receipts.map(r => `${r.firstName} ${r.lastName}`)).toEqual(["Zed Last", "Alice One"]);
    expect(receipts[0]).toEqual({
      bidId: "102",
      firstName: "Zed",
      lastName: "Last",
      email: "zed@example.com",
      itemsWon: ["803"],
      itemNames: ["Sushi Dinner"],
      itemPrices: [25],
      totalCost: 25,
    });
  });

  it("skips a bidder with no column in the Bid-Management matrix", async () => {
    mockSheets({ bidderNumbers: [BIDDER_NUMBERS_ROWS[0], ["999", "Ghost", "Person", "ghost@example.com"]] });
    const receipts = await buildAllBidderReceipts(fakeClient, "bm-id", "items-id");
    expect(receipts).toEqual([]);
  });

  it("skips a bidder with a column but no winning items", async () => {
    mockSheets({
      bidManagement: [["101", "", "", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]],
      bidderNumbers: [BIDDER_NUMBERS_ROWS[0], BIDDER_NUMBERS_ROWS[1]],
    });
    const receipts = await buildAllBidderReceipts(fakeClient, "bm-id", "items-id");
    expect(receipts).toEqual([]);
  });

  it("skips a blank bidder-ID row without throwing", async () => {
    mockSheets({ bidderNumbers: [BIDDER_NUMBERS_ROWS[0], ["", "", "", ""], BIDDER_NUMBERS_ROWS[1]] });
    const receipts = await buildAllBidderReceipts(fakeClient, "bm-id", "items-id");
    expect(receipts.map(r => r.bidId)).toEqual(["101"]);
  });
});

// ── Code Hardening item #2, Step 2: PayPal invoice resolution ──────────────
// server/services/receiptDataService.ts now also resolves/writes each
// bidder's PayPal invoice, ported from
// Class_ReceiptManager.gs's (now-removed) `getOrCreateInvoiceUrl`.

const RECEIPT_50: import("../services/receiptDataService").BidderReceiptData = {
  bidId: "101",
  firstName: "Alice",
  lastName: "One",
  email: "alice@example.com",
  itemsWon: ["801"],
  itemNames: ["Pizza Night"],
  itemPrices: [50],
  totalCost: 50,
};

function newSandboxPaypal(overrides: Record<string, unknown> = {}) {
  return new PayPalService({ isSandbox: true, clientId: "id", clientSecret: "secret", ...overrides });
}

describe("findExistingInvoice", () => {
  it("returns the existing URL/amount (columns J/K) for a bidder found in the sheet", () => {
    const rows = [
      ["ID", "First", "Last", "Email", "", "", "", "", "", "Invoice URL", "Invoice Total"],
      ["101", "Alice", "One", "alice@example.com", "", "", "", "", "", "https://paypal.com/x", "51.75"],
    ];
    expect(findExistingInvoice(rows, "101")).toEqual({ rowIndex: 2, url: "https://paypal.com/x", amount: 51.75 });
  });

  it("returns an empty url/zero amount when the bidder row exists but has no invoice yet", () => {
    expect(findExistingInvoice(BIDDER_NUMBERS_ROWS, "101")).toEqual({ rowIndex: 2, url: "", amount: 0 });
  });

  it("returns null for a bidder ID not present in the sheet", () => {
    expect(findExistingInvoice(BIDDER_NUMBERS_ROWS, "999")).toBeNull();
  });

  it("skips blank ID rows without throwing", () => {
    const rows = [BIDDER_NUMBERS_ROWS[0], ["", "", "", ""], BIDDER_NUMBERS_ROWS[1]];
    expect(findExistingInvoice(rows, "101")).toEqual({ rowIndex: 3, url: "", amount: 0 });
  });
});

describe("resolveInvoiceUrl", () => {
  it("reuses an existing invoice when the invoiced amount still matches (no PayPal API call)", async () => {
    const expected = calculatePayPalSurcharge(50).total;
    const fetcher = vi.fn();
    const paypal = newSandboxPaypal({ fetcher });

    const result = await resolveInvoiceUrl(paypal, RECEIPT_50, "101", {
      rowIndex: 2,
      url: "https://www.sandbox.paypal.com/invoice/p/#INV2-OLD",
      amount: expected,
    });

    expect(result).toEqual({ paymentUrl: "https://www.sandbox.paypal.com/invoice/p/#INV2-OLD", totalAmount: expected, changed: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["no email address", ""],
    ["an unusable email address", "n/a"],
  ])("sends the invoice to web-admin@orns.org for a bidder with %s (ROADMAP.md L8)", async (_label, email) => {
    const responses = [
      { status: 200, text: async () => "", json: async () => ({ access_token: "tok" }) },
      { status: 201, text: async () => JSON.stringify({ id: "INV2-NEW" }) },
      { status: 200, text: async () => JSON.stringify({ links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/invoice/p/#INV2-NEW" }] }) },
    ];
    let i = 0;
    const fetcher = vi.fn(() => Promise.resolve(responses[i++] as any));

    await resolveInvoiceUrl(newSandboxPaypal({ fetcher }), { ...RECEIPT_50, email }, "101", null);

    const draft = JSON.parse((fetcher.mock.calls[1] as any[])[1].body);
    expect(draft.primary_recipients[0].billing_info.email_address).toBe("web-admin@orns.org");
    // Still the bidder's name, so staff can tell whose invoice it is.
    expect(draft.primary_recipients[0].billing_info.name.given_name).toBe(RECEIPT_50.firstName);
  });

  it("sends the invoice to the bidder's own address when they have one", async () => {
    const responses = [
      { status: 200, text: async () => "", json: async () => ({ access_token: "tok" }) },
      { status: 201, text: async () => JSON.stringify({ id: "INV2-NEW" }) },
      { status: 200, text: async () => "{}" },
    ];
    let i = 0;
    const fetcher = vi.fn(() => Promise.resolve(responses[i++] as any));

    await resolveInvoiceUrl(newSandboxPaypal({ fetcher }), { ...RECEIPT_50, email: " alice@example.com " }, "101", null);

    const draft = JSON.parse((fetcher.mock.calls[1] as any[])[1].body);
    expect(draft.primary_recipients[0].billing_info.email_address).toBe("alice@example.com");
  });

  it("cancels a stale invoice and creates a fresh one when the amount no longer matches", async () => {
    const responses = [
      { status: 200, text: async () => "", json: async () => ({ access_token: "tok" }) }, // cancel's token fetch
      { status: 204, text: async () => "" }, // cancel itself
      { status: 200, text: async () => "", json: async () => ({ access_token: "tok" }) }, // createAndSendInvoice's token fetch
      { status: 201, text: async () => JSON.stringify({ id: "INV2-NEW" }) }, // draft
      { status: 200, text: async () => JSON.stringify({ links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/invoice/p/#INV2-NEW" }] }) }, // send
    ];
    let i = 0;
    const fetcher = vi.fn(() => Promise.resolve(responses[i++] as any));
    const paypal = newSandboxPaypal({ fetcher });

    const result = await resolveInvoiceUrl(paypal, RECEIPT_50, "101", {
      rowIndex: 2,
      url: "https://www.sandbox.paypal.com/invoice/p/#INV2-OLD",
      amount: 0, // stale - doesn't match RECEIPT_50's expected total
    });

    expect(result.changed).toBe(true);
    expect(result.paymentUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-NEW");
    // cancel (2 calls) + createAndSendInvoice (3 calls: token, draft, send)
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher).toHaveBeenNthCalledWith(2, expect.stringContaining("/invoices/INV2-OLD/cancel"), expect.anything());
  });

  it("proceeds to create a fresh invoice even if cancelling the stale one fails", async () => {
    const responses = [
      { status: 401, text: async () => "invalid_client", json: async () => { throw new Error("not json"); } }, // cancel's token fetch fails
      { status: 200, text: async () => "", json: async () => ({ access_token: "tok" }) }, // createAndSendInvoice's token fetch
      { status: 201, text: async () => JSON.stringify({ id: "INV2-NEW" }) },
      { status: 202, text: async () => "" },
    ];
    let i = 0;
    const fetcher = vi.fn(() => Promise.resolve(responses[i++] as any));
    const paypal = newSandboxPaypal({ fetcher });

    const result = await resolveInvoiceUrl(paypal, RECEIPT_50, "101", {
      rowIndex: 2,
      url: "https://www.sandbox.paypal.com/invoice/p/#INV2-OLD",
      amount: 0,
    });

    expect(result.changed).toBe(true);
    expect(result.paymentUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-NEW");
  });

  it("creates a fresh invoice when there's no existing URL at all", async () => {
    const responses = [
      { status: 200, text: async () => "", json: async () => ({ access_token: "tok" }) },
      { status: 201, text: async () => JSON.stringify({ id: "INV2-FRESH" }) },
      { status: 200, text: async () => JSON.stringify({ links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/invoice/p/#INV2-FRESH" }] }) },
    ];
    let i = 0;
    const fetcher = vi.fn(() => Promise.resolve(responses[i++] as any));
    const paypal = newSandboxPaypal({ fetcher });

    const result = await resolveInvoiceUrl(paypal, RECEIPT_50, "101", { rowIndex: 2, url: "", amount: 0 });

    expect(result.changed).toBe(true);
    expect(result.paymentUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-FRESH");
  });

  it("creates a fresh invoice when existing is null", async () => {
    const responses = [
      { status: 200, text: async () => "", json: async () => ({ access_token: "tok" }) },
      { status: 201, text: async () => JSON.stringify({ id: "INV2-FRESH" }) },
      { status: 202, text: async () => "" },
    ];
    let i = 0;
    const fetcher = vi.fn(() => Promise.resolve(responses[i++] as any));
    const paypal = newSandboxPaypal({ fetcher });

    const result = await resolveInvoiceUrl(paypal, RECEIPT_50, "101", null);
    expect(result.changed).toBe(true);
  });
});

describe("buildBidderReceiptWithInvoice", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("resolves the receipt and creates a fresh invoice (relying on the default PayPal sandbox mocks), then writes J/K back to the sheet", async () => {
    mockSheets();
    const paypal = newSandboxPaypal(); // no fetcher override - exercises the real PayPal MSW handlers

    let capturedUpdate: any = null;
    server.use(
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ params, request }) => {
        capturedUpdate = { range: decodeURIComponent(String(params.range)), body: await request.clone().json() };
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const result = await buildBidderReceiptWithInvoice(fakeClient, "bm-id", "items-id", "101", paypal);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.receipt.paymentUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-MOCK-0000-0000-0001");
      expect(result.receipt.adjustedTotal).toBeCloseTo(calculatePayPalSurcharge(50).total, 2);
    }
    expect(capturedUpdate.range).toBe("'Bidder-Numbers'!J2:K2");
    expect(capturedUpdate.body.values[0][0]).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-MOCK-0000-0000-0001");
  });

  it("does not call PayPal at all when the existing invoice already matches (reuse path)", async () => {
    const expected = calculatePayPalSurcharge(50).total;
    mockSheets({
      bidderNumbers: [
        BIDDER_NUMBERS_ROWS[0],
        ["101", "Alice", "One", "alice@example.com", "", "", "", "", "", "https://www.sandbox.paypal.com/invoice/p/#INV2-REUSE", String(expected)],
        BIDDER_NUMBERS_ROWS[2],
      ],
    });
    const fetcher = vi.fn();
    const paypal = newSandboxPaypal({ fetcher });

    const result = await buildBidderReceiptWithInvoice(fakeClient, "bm-id", "items-id", "101", paypal);

    expect(result.success).toBe(true);
    if (result.success) expect(result.receipt.paymentUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-REUSE");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads and writes the configured tab names, not the defaults (ROADMAP.md L1)", async () => {
    const requestedRanges: string[] = [];
    let capturedUpdateRange = "";
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ params }) => {
        const range = decodeURIComponent(String(params.range));
        requestedRanges.push(range);
        if (range.startsWith("'Bids 2026'!")) return HttpResponse.json({ values: BID_MANAGEMENT_ROWS });
        if (range.startsWith("'Dan''s Bidders'!")) return HttpResponse.json({ values: BIDDER_NUMBERS_ROWS });
        if (range.includes("Auction-Items")) return HttpResponse.json({ values: AUCTION_ITEMS_ROWS });
        return HttpResponse.json({ values: [] });
      }),
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ params }) => {
        capturedUpdateRange = decodeURIComponent(String(params.range));
        return HttpResponse.json({ updatedRows: 1 });
      })
    );

    const result = await buildBidderReceiptWithInvoice(fakeClient, "bm-id", "items-id", "101", newSandboxPaypal(), {
      bidderNumbers: "Dan's Bidders",
      bidManagement: "Bids 2026",
    });

    expect(result.success).toBe(true);
    expect(capturedUpdateRange).toBe("'Dan''s Bidders'!J2:K2");
    expect(requestedRanges.some((r) => r.includes("Bidder-Numbers") || r.includes("Bid-Management"))).toBe(false);
  });

  it("propagates the underlying buildBidderReceipt error without ever touching PayPal", async () => {
    mockSheets();
    const fetcher = vi.fn();
    const paypal = newSandboxPaypal({ fetcher });

    const result = await buildBidderReceiptWithInvoice(fakeClient, "bm-id", "items-id", "999", paypal);

    expect(result).toEqual({ success: false, error: "Bidder ID 999 not found in the Bidder-Numbers sheet." });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("buildAllBidderReceiptsWithInvoices", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  /**
   * Bidder-Numbers backed by mutable state, so a J/K write is visible to
   * the next read - needed to reproduce ROADMAP.md H1 (a re-run after an
   * interrupted batch must reuse what the first run saved). `failPutForRows`
   * makes the J/K write for those sheet rows fail with a non-retried 400.
   */
  function mockStatefulSheets(log: string[], failPutForRows: Set<number> = new Set()) {
    const bidderNumbers = BIDDER_NUMBERS_ROWS.map((row) => [...row, "", "", "", "", "", "", ""]);
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.includes("Bid-Management")) return HttpResponse.json({ values: BID_MANAGEMENT_ROWS });
        if (url.pathname.includes("Bidder-Numbers")) return HttpResponse.json({ values: bidderNumbers });
        if (url.pathname.includes("Auction-Items")) return HttpResponse.json({ values: AUCTION_ITEMS_ROWS });
        return HttpResponse.json({ values: [] });
      }),
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ params, request }) => {
        const range = decodeURIComponent(String(params.range));
        const sheetRow = Number(range.match(/J(\d+):K/)![1]);
        if (failPutForRows.has(sheetRow)) {
          log.push(`persist-failed:${sheetRow}`);
          return HttpResponse.json({ error: { code: 400, message: "write rejected" } }, { status: 400 });
        }
        const body: any = await request.clone().json();
        bidderNumbers[sheetRow - 1][9] = body.values[0][0];
        bidderNumbers[sheetRow - 1][10] = body.values[0][1];
        log.push(`persist:${sheetRow}`);
        return HttpResponse.json({ updatedRows: 1 });
      })
    );
    return bidderNumbers;
  }

  /** Real (MSW-backed) fetch that also logs each invoice creation. */
  function loggingFetcher(log: string[]): typeof fetch {
    return ((url: any, init?: RequestInit) => {
      if (String(url).endsWith("/v2/invoicing/invoices") && init?.method === "POST") log.push("create");
      return fetch(url, init);
    }) as typeof fetch;
  }

  it("writes each new invoice to J/K immediately, before creating the next bidder's invoice", async () => {
    const log: string[] = [];
    mockStatefulSheets(log);
    const paypal = newSandboxPaypal({ fetcher: loggingFetcher(log) });

    const receipts = await buildAllBidderReceiptsWithInvoices(fakeClient, "bm-id", "items-id", paypal);

    expect(receipts).toHaveLength(2);
    expect(receipts.every(r => r.paymentUrl.startsWith("https://www.sandbox.paypal.com/invoice/p/#"))).toBe(true);
    // Sorted by last name: Zed Last (row 3) first, then Alice One (row 2).
    expect(log).toEqual(["create", "persist:3", "create", "persist:2"]);
  });

  it("stops the batch when a J/K write fails, so no further invoices are sent unrecorded", async () => {
    const log: string[] = [];
    mockStatefulSheets(log, new Set([3]));
    const paypal = newSandboxPaypal({ fetcher: loggingFetcher(log) });

    await expect(buildAllBidderReceiptsWithInvoices(fakeClient, "bm-id", "items-id", paypal))
      .rejects.toThrow(/sent to bidder 102 but could not be saved to Bidder-Numbers row 3/);
    expect(log).toEqual(["create", "persist-failed:3"]);
  });

  it("re-running after an interrupted batch reuses the invoices already saved instead of duplicating them", async () => {
    const log: string[] = [];
    const failRows = new Set([2]);
    const bidderNumbers = mockStatefulSheets(log, failRows);
    const paypal = newSandboxPaypal({ fetcher: loggingFetcher(log) });

    // First run: Zed's invoice is created and saved, then Alice's save fails.
    await expect(buildAllBidderReceiptsWithInvoices(fakeClient, "bm-id", "items-id", paypal)).rejects.toThrow();
    // Staff enter Alice's invoice by hand, as the error message instructs.
    bidderNumbers[1][9] = "https://www.sandbox.paypal.com/invoice/p/#INV2-MOCK-0000-0000-0001";
    bidderNumbers[1][10] = String(calculatePayPalSurcharge(50).total);
    failRows.clear();

    const receipts = await buildAllBidderReceiptsWithInvoices(fakeClient, "bm-id", "items-id", paypal);

    expect(receipts).toHaveLength(2);
    // Exactly one invoice per bidder across both runs - the second run created none.
    expect(log.filter((e) => e === "create")).toHaveLength(2);
    expect(log).toEqual(["create", "persist:3", "create", "persist-failed:2"]);
  });

  it("skips a bidder whose invoice resolution throws, without aborting the batch", async () => {
    mockSheets();
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("network down"));
      return Promise.resolve({ status: 200, text: async () => "", json: async () => ({ access_token: "tok" }) } as any);
    });
    // Force every createAndSendInvoice call to go through the injected
    // fetcher (both bidders have no existing invoice, so both create).
    const paypal = newSandboxPaypal({ fetcher });

    const receipts = await buildAllBidderReceiptsWithInvoices(fakeClient, "bm-id", "items-id", paypal);

    // The first bidder resolved (Zed Last, per the last-name sort) fails
    // its token fetch and is skipped; the rest still get resolved rather
    // than aborting the whole batch.
    expect(receipts.length).toBeLessThan(2);
  });
});
