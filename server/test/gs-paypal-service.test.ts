/**
 * Tests the REAL source of scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/not-deployed/Class_PayPalService.gs
 * (the Google Apps Script bound to the live Bid-Management spreadsheet,
 * loaded via helpers/loadGasClass - not a Node reimplementation that could
 * drift from it) using an injected fetcher in place of UrlFetchApp.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect, vi } from "vitest";
import { loadGasClass } from "./helpers/loadGasClass";
import { calculatePayPalSurcharge as calculatePayPalSurchargeNode } from "../utils/financeUtils";

const PayPalService = loadGasClass<any>(
  "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/not-deployed/Class_PayPalService.gs",
  "PayPalService"
);

function mockFetchResponse(responseCode: number, body: unknown) {
  return {
    getResponseCode: () => responseCode,
    getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function newService(overrides: Record<string, unknown> = {}) {
  return new PayPalService({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    isSandbox: true,
    fetcher: vi.fn(),
    ...overrides,
  });
}

describe("PayPalService.extractInvoiceIdFromUrl", () => {
  it("extracts the ID from a real production URL (# fragment, INV2- prefix)", () => {
    const paypal = newService();
    expect(
      paypal.extractInvoiceIdFromUrl("https://www.paypal.com/invoice/p/#INV2-6WTA-NK56-2FAQ-PVGR")
    ).toBe("INV2-6WTA-NK56-2FAQ-PVGR");
  });

  it("normalizes a real sandbox URL's lowercase inv- prefix to INV2-", () => {
    const paypal = newService();
    expect(
      paypal.extractInvoiceIdFromUrl("https://www.sandbox.paypal.com/invoice/p/#inv-H38U-JGHJ-F3UZ-HLX3")
    ).toBe("INV2-H38U-JGHJ-F3UZ-HLX3");
  });

  it("does not double-prefix a fragment that's already INV2-", () => {
    const paypal = newService();
    expect(
      paypal.extractInvoiceIdFromUrl("https://www.paypal.com/invoice/p/#INV2-AZ93-LKDZ-4VNS-A6KZ")
    ).toBe("INV2-AZ93-LKDZ-4VNS-A6KZ");
  });

  it("falls back to the last path segment when there's no # fragment", () => {
    const paypal = newService();
    expect(paypal.extractInvoiceIdFromUrl("https://www.paypal.com/invoice/p/INV2-XXXX")).toBe("INV2-XXXX");
  });

  it("returns null for empty, null, or non-string input", () => {
    const paypal = newService();
    expect(paypal.extractInvoiceIdFromUrl("")).toBeNull();
    expect(paypal.extractInvoiceIdFromUrl(null)).toBeNull();
    expect(paypal.extractInvoiceIdFromUrl(undefined)).toBeNull();
    expect(paypal.extractInvoiceIdFromUrl(12345 as any)).toBeNull();
  });
});

describe("PayPalService.calculatePayPalSurcharge", () => {
  it("matches this app's own server-side copy for a range of amounts (cross-runtime drift check)", () => {
    const paypal = newService();
    for (const amount of [0, 5, 27.5, 100, 349.99, 10000]) {
      expect(paypal.calculatePayPalSurcharge(amount)).toEqual(calculatePayPalSurchargeNode(amount));
    }
  });

  it("computes the documented 3.49% + $0.49 rate", () => {
    const paypal = newService();
    // (100 + 0.49) / (1 - 0.0349) = 104.1250... -> rounds to 104.12
    expect(paypal.calculatePayPalSurcharge(100)).toEqual({ total: 104.12, surcharge: 4.12 });
  });
});

describe("PayPalService.getAccessToken_", () => {
  it("throws when credentials are missing", () => {
    const paypal = newService({ clientId: "", clientSecret: "" });
    expect(() => paypal.getAccessToken_()).toThrow(/Missing PayPal credentials/);
  });

  it("returns the access token on a 200 response", () => {
    const fetcher = vi.fn().mockReturnValue(mockFetchResponse(200, { access_token: "token-abc-123" }));
    const paypal = newService({ fetcher });
    expect(paypal.getAccessToken_()).toBe("token-abc-123");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      expect.objectContaining({ method: "post" })
    );
  });

  it("throws with the response body when PayPal returns a non-200", () => {
    const fetcher = vi.fn().mockReturnValue(mockFetchResponse(401, "invalid_client"));
    const paypal = newService({ fetcher });
    expect(() => paypal.getAccessToken_()).toThrow(/PayPal API Authentication Failed/);
  });
});

describe("PayPalService.createAndSendInvoice", () => {
  it("builds one line item per winning item plus a surcharge line, and returns the checkout URL", () => {
    // createAndSendInvoice's `.gs` source reuses and mutates the same
    // `options` object across its draft/send fetch calls, so vi.fn()'s
    // recorded call args are a live reference, not a snapshot - capture
    // each call's payload STRING (immutable by value) at call-time instead
    // of reading it back from mock.calls after the fact.
    const capturedPayloads: string[] = [];
    const responses = [
      mockFetchResponse(200, { access_token: "tok" }),
      mockFetchResponse(201, { id: "INV2-TEST-0000-0000-0001" }),
      mockFetchResponse(200, {
        links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/invoice/p/#inv-TEST0000000001" }],
      }),
    ];
    let callIndex = 0;
    const fetcher = vi.fn((_url: string, options: any) => {
      capturedPayloads.push(options.payload);
      return responses[callIndex++];
    });
    const paypal = newService({ fetcher, clientId: "id", clientSecret: "secret" });

    const result = paypal.createAndSendInvoice(
      { email: "bidder@example.com", firstName: "Jane", lastName: "Doe", id: "101" },
      [
        { name: "Gift Card", amount: 100 },
        { name: "Ten Raffle Tickets", amount: 30 },
      ]
    );

    const feeData = calculatePayPalSurchargeNode(130); // 100 + 30

    expect(result).toEqual({
      invoiceId: "INV2-TEST-0000-0000-0001",
      totalAmount: feeData.total,
      checkoutUrl: "https://www.sandbox.paypal.com/invoice/p/#inv-TEST0000000001",
    });

    // capturedPayloads[0] is the token request; [1] is the draft invoice
    const draftPayload = JSON.parse(capturedPayloads[1]);
    expect(draftPayload.items).toEqual([
      { name: "Gift Card", quantity: "1", unit_amount: { currency_code: "USD", value: "100.00" } },
      { name: "Ten Raffle Tickets", quantity: "1", unit_amount: { currency_code: "USD", value: "30.00" } },
      { name: "Merchant Processing Surcharge Fee", quantity: "1", unit_amount: { currency_code: "USD", value: feeData.surcharge.toFixed(2) } },
    ]);
    expect(draftPayload.detail.reference).toBe("Bidder #101");
    expect(draftPayload.primary_recipients[0].billing_info.email_address).toBe("bidder@example.com");
  });

  it("falls back to a constructed checkout URL when the send response has no payer-action link", () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockReturnValueOnce(mockFetchResponse(201, { id: "INV2-TEST-0000-0000-0002" }))
      .mockReturnValueOnce(mockFetchResponse(202, "")); // empty body, no links

    const paypal = newService({ fetcher, isSandbox: true });
    const result = paypal.createAndSendInvoice(
      { email: "bidder@example.com", firstName: "Jane", lastName: "Doe", id: "101" },
      [{ name: "Item", amount: 50 }]
    );

    expect(result.checkoutUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-0000-0000-0002");
  });

  it("throws when bidderInfo has no email", () => {
    const paypal = newService();
    expect(() => paypal.createAndSendInvoice({ firstName: "Jane" }, [{ name: "x", amount: 1 }])).toThrow(
      /must include an email address/
    );
  });

  it("throws when lineItems is empty", () => {
    const paypal = newService();
    expect(() => paypal.createAndSendInvoice({ email: "a@b.com" }, [])).toThrow(/non-empty array/);
  });
});

describe("PayPalService.recordOfflinePayment", () => {
  it("normalizes a bare 16-char share token into the API's INV2- resource ID", () => {
    const fetcher = vi.fn().mockReturnValue(mockFetchResponse(200, {}));
    const paypal = newService({ fetcher });
    paypal.recordOfflinePayment("8MZG5YJDQA37VE2R", "CASH", 100);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/v2/invoicing/invoices/INV2-8MZG-5YJD-QA37-VE2R/payments"),
      expect.anything()
    );
  });

  it("leaves an already-prefixed invoice ID unchanged", () => {
    const fetcher = vi.fn().mockReturnValue(mockFetchResponse(200, {}));
    const paypal = newService({ fetcher });
    paypal.recordOfflinePayment("INV2-AZ93-LKDZ-4VNS-A6KZ", "CASH", 100);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/v2/invoicing/invoices/INV2-AZ93-LKDZ-4VNS-A6KZ/payments"),
      expect.anything()
    );
  });

  it("sends the payment method uppercased and the amount as a fixed-2 string", () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockReturnValueOnce(mockFetchResponse(200, {}));
    const paypal = newService({ fetcher });
    paypal.recordOfflinePayment("INV2-AZ93-LKDZ-4VNS-A6KZ", "cash", 42.5);
    // calls[0] is the token fetch; the payment-recording request is calls[1]
    const payload = JSON.parse(fetcher.mock.calls[1][1].payload);
    expect(payload.method).toBe("CASH");
    expect(payload.amount).toEqual({ currency_code: "USD", value: "42.50" });
  });

  it.each([200, 202, 204])("treats a %i response as success", (status) => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockReturnValueOnce(mockFetchResponse(status, {}));
    const paypal = newService({ fetcher });
    expect(paypal.recordOfflinePayment("INV2-X", "CASH", 10)).toBe(true);
  });

  it("treats any other status as failure", () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockReturnValueOnce(mockFetchResponse(404, "not found"));
    const paypal = newService({ fetcher });
    expect(paypal.recordOfflinePayment("INV2-X", "CASH", 10)).toBe(false);
  });
});

describe("PayPalService.getInvoiceStatus", () => {
  it("returns the status field on a 200 response", () => {
    const fetcher = vi.fn().mockReturnValue(mockFetchResponse(200, { status: "PAID" }));
    const paypal = newService({ fetcher });
    expect(paypal.getInvoiceStatus("INV2-X")).toBe("PAID");
  });

  it("throws with the response body on a non-200", () => {
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockReturnValueOnce(mockFetchResponse(404, "invoice not found"));
    const paypal = newService({ fetcher });
    expect(() => paypal.getInvoiceStatus("INV2-X")).toThrow(/PayPal Live Lookup Failed/);
  });

  it("throws when no invoice ID is given", () => {
    const paypal = newService();
    expect(() => paypal.getInvoiceStatus("")).toThrow(/Invoice ID is required/);
  });
});
