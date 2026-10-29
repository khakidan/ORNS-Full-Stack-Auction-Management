/**
 * Tests server/services/paypalService.ts - the Node port of
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/not-deployed/Class_PayPalService.gs
 * (see server/test/gs-paypal-service.test.ts for the GAS reference-copy's
 * own tests, which this mirrors method-for-method). See
 * docs/agents/CHANGELOG.md's Code Hardening item #2, Step 1.
 */
import { describe, it, expect, vi } from "vitest";
import { PayPalService } from "../services/paypalService";
import { calculatePayPalSurcharge } from "../utils/financeUtils";

function mockFetchResponse(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    text: async () => text,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  } as Response;
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

describe("PayPalService credential resolution", () => {
  /** The Basic auth header the token request sends, decoded to "id:secret". */
  async function credentialsSent(isSandbox: boolean) {
    const fetcher = vi.fn().mockResolvedValue(mockFetchResponse(200, { access_token: "tok" }));
    await (new PayPalService({ fetcher, isSandbox }) as any).getAccessToken_();
    const auth = fetcher.mock.calls[0][1].headers.Authorization as string;
    return Buffer.from(auth.replace(/^Basic /, ""), "base64").toString();
  }

  it("uses the sandbox app's credentials in sandbox and the live app's in live - Settings' switch is all it takes", async () => {
    expect(await credentialsSent(true)).toBe("test-sandbox-paypal-client-id:test-sandbox-paypal-client-secret");
    expect(await credentialsSent(false)).toBe("test-paypal-client-id:test-paypal-client-secret");
  });

  it("never uses the live credentials in sandbox, or the other way round - a missing pair fails and says which", async () => {
    vi.stubEnv("SANDBOX_PAYPAL_CLIENT_ID", "");
    vi.stubEnv("SANDBOX_PAYPAL_CLIENT_SECRET", "");
    await expect((new PayPalService({ fetcher: vi.fn(), isSandbox: true }) as any).getAccessToken_())
      .rejects.toThrow("Missing PayPal sandbox credentials in your environment variables (SANDBOX_PAYPAL_CLIENT_ID / SANDBOX_PAYPAL_CLIENT_SECRET)!");
    vi.unstubAllEnvs();

    vi.stubEnv("PAYPAL_CLIENT_ID", "");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "");
    await expect((new PayPalService({ fetcher: vi.fn(), isSandbox: false }) as any).getAccessToken_())
      .rejects.toThrow("Missing PayPal live credentials in your environment variables (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)!");
    vi.unstubAllEnvs();
  });
});

describe("PayPalService sandbox/production base URL selection", () => {
  it("targets api-m.sandbox.paypal.com when isSandbox is true", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockFetchResponse(200, { access_token: "tok" }));
    const paypal = newService({ fetcher, isSandbox: true });
    await (paypal as any).getAccessToken_();
    expect(fetcher).toHaveBeenCalledWith("https://api-m.sandbox.paypal.com/v1/oauth2/token", expect.anything());
  });

  it("targets the live api-m.paypal.com when isSandbox is false", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockFetchResponse(200, { access_token: "tok" }));
    const paypal = newService({ fetcher, isSandbox: false });
    await (paypal as any).getAccessToken_();
    expect(fetcher).toHaveBeenCalledWith("https://api-m.paypal.com/v1/oauth2/token", expect.anything());
  });

  it("defaults to sandbox when isSandbox is omitted and no env var is set", async () => {
    vi.stubEnv("PAYPAL_IS_SANDBOX", "");
    const fetcher = vi.fn().mockResolvedValue(mockFetchResponse(200, { access_token: "tok" }));
    const paypal = new PayPalService({ fetcher, clientId: "id", clientSecret: "secret" });
    await (paypal as any).getAccessToken_();
    expect(fetcher).toHaveBeenCalledWith("https://api-m.sandbox.paypal.com/v1/oauth2/token", expect.anything());
    vi.unstubAllEnvs();
  });

  it("honors PAYPAL_IS_SANDBOX=false from the environment when no override is given", async () => {
    vi.stubEnv("PAYPAL_IS_SANDBOX", "false");
    const fetcher = vi.fn().mockResolvedValue(mockFetchResponse(200, { access_token: "tok" }));
    const paypal = new PayPalService({ fetcher, clientId: "id", clientSecret: "secret" });
    await (paypal as any).getAccessToken_();
    expect(fetcher).toHaveBeenCalledWith("https://api-m.paypal.com/v1/oauth2/token", expect.anything());
    vi.unstubAllEnvs();
  });
});

describe("PayPalService.cancelInvoice", () => {
  it("sends a cancel request with a non-recipient-facing note", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(204, ""));
    const paypal = newService({ fetcher });

    await paypal.cancelInvoice("INV2-CANCEL-ME");

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-CANCEL-ME/cancel",
      expect.objectContaining({ method: "POST" })
    );
    const payload = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(payload.send_to_recipient).toBe(false);
  });
});

describe("PayPalService.getAccessToken_", () => {
  it("throws when credentials are missing", async () => {
    const paypal = newService({ clientId: "", clientSecret: "" });
    await expect((paypal as any).getAccessToken_()).rejects.toThrow(/Missing PayPal (sandbox|live) credentials/);
  });

  it("returns the access token on a 200 response", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockFetchResponse(200, { access_token: "token-abc-123" }));
    const paypal = newService({ fetcher });
    await expect((paypal as any).getAccessToken_()).resolves.toBe("token-abc-123");
    expect(fetcher).toHaveBeenCalledWith(
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws with the response body when PayPal returns a non-200", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockFetchResponse(401, "invalid_client"));
    const paypal = newService({ fetcher });
    await expect((paypal as any).getAccessToken_()).rejects.toThrow(/PayPal API Authentication Failed/);
  });
});

describe("PayPalService.createAndSendInvoice", () => {
  it("builds one line item per winning item plus a surcharge line, and returns the checkout URL", async () => {
    const capturedBodies: string[] = [];
    const responses = [
      mockFetchResponse(200, { access_token: "tok" }),
      mockFetchResponse(201, { id: "INV2-TEST-0000-0000-0001" }),
      mockFetchResponse(200, {
        links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/invoice/p/#inv-TEST0000000001" }],
      }),
    ];
    let callIndex = 0;
    const fetcher = vi.fn((_url: string, options: any) => {
      capturedBodies.push(options.body);
      return Promise.resolve(responses[callIndex++]);
    });
    const paypal = newService({ fetcher, clientId: "id", clientSecret: "secret" });

    const result = await paypal.createAndSendInvoice(
      { email: "bidder@example.com", firstName: "Jane", lastName: "Doe", id: "101" },
      [
        { name: "Gift Card", amount: 100 },
        { name: "Ten Raffle Tickets", amount: 30 },
      ]
    );

    const feeData = calculatePayPalSurcharge(130); // 100 + 30

    expect(result).toEqual({
      invoiceId: "INV2-TEST-0000-0000-0001",
      totalAmount: feeData.total,
      checkoutUrl: "https://www.sandbox.paypal.com/invoice/p/#inv-TEST0000000001",
    });

    // capturedBodies[0] is the token request; [1] is the draft invoice
    const draftPayload = JSON.parse(capturedBodies[1]);
    expect(draftPayload.items).toEqual([
      { name: "Gift Card", quantity: "1", unit_amount: { currency_code: "USD", value: "100.00" } },
      { name: "Ten Raffle Tickets", quantity: "1", unit_amount: { currency_code: "USD", value: "30.00" } },
      { name: "Merchant Processing Surcharge Fee", quantity: "1", unit_amount: { currency_code: "USD", value: feeData.surcharge.toFixed(2) } },
    ]);
    expect(draftPayload.detail.reference).toBe("Bidder #101");
    expect(draftPayload.primary_recipients[0].billing_info.email_address).toBe("bidder@example.com");
  });

  it("falls back to a constructed checkout URL when the send response has no payer-action link", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(201, { id: "INV2-TEST-0000-0000-0002" }))
      .mockResolvedValueOnce(mockFetchResponse(202, ""));

    const paypal = newService({ fetcher, isSandbox: true });
    const result = await paypal.createAndSendInvoice(
      { email: "bidder@example.com", firstName: "Jane", lastName: "Doe", id: "101" },
      [{ name: "Item", amount: 50 }]
    );

    expect(result.checkoutUrl).toBe("https://www.sandbox.paypal.com/invoice/p/#INV2-TEST-0000-0000-0002");
  });

  it("throws when bidderInfo has no email", async () => {
    const paypal = newService();
    await expect(
      paypal.createAndSendInvoice({ firstName: "Jane" } as any, [{ name: "x", amount: 1 }])
    ).rejects.toThrow(/must include an email address/);
  });

  it("throws when lineItems is empty", async () => {
    const paypal = newService();
    await expect(paypal.createAndSendInvoice({ email: "a@b.com" } as any, [])).rejects.toThrow(/non-empty array/);
  });
});

describe("PayPalService.recordOfflinePayment", () => {
  it("normalizes a bare 16-char share token into the API's INV2- resource ID", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(200, {}));
    const paypal = newService({ fetcher });
    await paypal.recordOfflinePayment("8MZG5YJDQA37VE2R", "CASH", 100);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/v2/invoicing/invoices/INV2-8MZG-5YJD-QA37-VE2R/payments"),
      expect.anything()
    );
  });

  it("leaves an already-prefixed invoice ID unchanged", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(200, {}));
    const paypal = newService({ fetcher });
    await paypal.recordOfflinePayment("INV2-AZ93-LKDZ-4VNS-A6KZ", "CASH", 100);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/v2/invoicing/invoices/INV2-AZ93-LKDZ-4VNS-A6KZ/payments"),
      expect.anything()
    );
  });

  it("sends the payment method uppercased and the amount as a fixed-2 string", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(200, {}));
    const paypal = newService({ fetcher });
    await paypal.recordOfflinePayment("INV2-AZ93-LKDZ-4VNS-A6KZ", "cash", 42.5);
    // calls[0] is the token fetch; the payment-recording request is calls[1]
    const payload = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(payload.method).toBe("CASH");
    expect(payload.amount).toEqual({ currency_code: "USD", value: "42.50" });
  });

  it.each([200, 202, 204])("treats a %i response as success", async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(status, {}));
    const paypal = newService({ fetcher });
    await expect(paypal.recordOfflinePayment("INV2-X", "CASH", 10)).resolves.toBe(true);
  });

  it("treats any other status as failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(404, "not found"));
    const paypal = newService({ fetcher });
    await expect(paypal.recordOfflinePayment("INV2-X", "CASH", 10)).resolves.toBe(false);
  });
});

describe("PayPalService.getInvoiceStatus", () => {
  it("returns the status field on a 200 response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(200, { status: "PAID" }));
    const paypal = newService({ fetcher });
    await expect(paypal.getInvoiceStatus("INV2-X")).resolves.toBe("PAID");
  });

  it("throws with the response body on a non-200", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(404, "invoice not found"));
    const paypal = newService({ fetcher });
    await expect(paypal.getInvoiceStatus("INV2-X")).rejects.toThrow(/PayPal Live Lookup Failed/);
  });

  it("throws when no invoice ID is given", async () => {
    const paypal = newService();
    await expect(paypal.getInvoiceStatus("")).rejects.toThrow(/Invoice ID is required/);
  });
});

describe("PayPalService.removeSurchargeLine (ROADMAP.md L3 - cash/check payers don't owe the surcharge)", () => {
  const INVOICE = {
    id: "INV2-AAAA",
    status: "UNPAID",
    detail: { currency_code: "USD", reference: "Bidder #101" },
    primary_recipients: [{ billing_info: { email_address: "alice@example.com" } }],
    items: [
      { name: "Weekend Cabin", quantity: "1", unit_amount: { currency_code: "USD", value: "60.00" } },
      { name: "Gift Basket", quantity: "1", unit_amount: { currency_code: "USD", value: "40.00" } },
      { name: "Merchant Processing Surcharge Fee", quantity: "1", unit_amount: { currency_code: "USD", value: "3.98" } },
    ],
    amount: { currency_code: "USD", value: "103.98" },
    due_amount: { currency_code: "USD", value: "103.98" },
    links: [{ rel: "self", href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-AAAA" }],
  };

  it("drops the surcharge line with a full-replace PUT that emails nobody, and returns the fee-free total", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(200, INVOICE))
      .mockResolvedValueOnce(mockFetchResponse(200, { ...INVOICE, items: INVOICE.items.slice(0, 2) }));
    const paypal = newService({ fetcher });

    const result = await paypal.removeSurchargeLine("INV2-AAAA");

    expect(result).toEqual({ status: "UNPAID", total: 100, removed: true });
    const [url, init] = fetcher.mock.calls[2];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-AAAA?send_to_recipient=false&send_to_invoicer=false");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.items.map((i: any) => i.name)).toEqual(["Weekend Cabin", "Gift Basket"]);
    // PayPal recomputes these from the lines; sending the old ones back would conflict.
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("due_amount");
    expect(body).not.toHaveProperty("links");
    // Everything else is sent back unchanged (PUT clears what's left out).
    expect(body.primary_recipients).toEqual(INVOICE.primary_recipients);
    expect(body.detail).toEqual(INVOICE.detail);
  });

  it("changes nothing on an invoice that's already paid", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(200, { ...INVOICE, status: "PAID" }));
    const paypal = newService({ fetcher });

    const result = await paypal.removeSurchargeLine("INV2-AAAA");

    expect(result).toEqual({ status: "PAID", total: 103.98, removed: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("changes nothing when there's no surcharge line (already removed)", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(200, { ...INVOICE, items: INVOICE.items.slice(0, 2), amount: { value: "100.00" } }));
    const paypal = newService({ fetcher });

    const result = await paypal.removeSurchargeLine("INV2-AAAA");

    expect(result).toEqual({ status: "UNPAID", total: 100, removed: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws when PayPal rejects the update", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mockFetchResponse(200, { access_token: "tok" }))
      .mockResolvedValueOnce(mockFetchResponse(200, INVOICE))
      .mockResolvedValueOnce(mockFetchResponse(422, { name: "UNPROCESSABLE_ENTITY" }));
    const paypal = newService({ fetcher });

    await expect(paypal.removeSurchargeLine("INV2-AAAA")).rejects.toThrow(/update failed \(422\)/);
  });
});

describe("PayPalService.getPayment (ROADMAP W4)", () => {
  const around = new Date("2026-04-25T12:05:02Z");
  /** Answers the token call, then each lookup by URL. */
  function fetcherFor(routes: Record<string, [number, unknown]>) {
    return vi.fn(async (url: string) => {
      if (url.endsWith("/v1/oauth2/token")) return mockFetchResponse(200, { access_token: "tok" });
      const match = Object.keys(routes).find((path) => url.includes(path));
      if (!match) throw new Error(`unexpected ${url}`);
      return mockFetchResponse(...routes[match]);
    });
  }

  it("says why a pending capture is pending (PayPal holding it for review)", async () => {
    const fetcher = fetcherFor({ "/v2/payments/captures/9AB12345CD678901E": [200, { status: "PENDING", status_details: { reason: "PENDING_REVIEW" }, amount: { value: "70.00", currency_code: "USD" } }] });

    expect(await newService({ fetcher }).getPayment("9AB12345CD678901E", around)).toEqual({ status: "PENDING", amount: 70, currency: "USD", pendingReason: "PENDING_REVIEW" });
  });

  it("reads a PayPal Checkout payment from the Captures API", async () => {
    const fetcher = fetcherFor({ "/v2/payments/captures/9AB12345CD678901E": [200, { status: "COMPLETED", amount: { value: "70.00", currency_code: "USD" } }] });

    const payment = await newService({ fetcher }).getPayment("9AB12345CD678901E", around);

    expect(payment).toEqual({ status: "COMPLETED", amount: 70, currency: "USD" });
  });

  it("falls back to Transaction Search for a PayPal Standard payment, within a 31-day window around it", async () => {
    const fetcher = fetcherFor({
      "/v2/payments/captures/": [404, { name: "RESOURCE_NOT_FOUND" }],
      "/v1/reporting/transactions": [200, { transaction_details: [{ transaction_info: { transaction_status: "S", transaction_amount: { value: "70.00", currency_code: "USD" } } }] }],
    });

    const payment = await newService({ fetcher }).getPayment("9AB12345CD678901E", around);

    expect(payment).toEqual({ status: "COMPLETED", amount: 70, currency: "USD" });
    const searchUrl = new URL(fetcher.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/reporting/"))!);
    expect(searchUrl.searchParams.get("transaction_id")).toBe("9AB12345CD678901E");
    const days = (Date.parse(searchUrl.searchParams.get("end_date")!) - Date.parse(searchUrl.searchParams.get("start_date")!)) / 86400000;
    expect(days).toBeLessThanOrEqual(31);
    expect(Date.parse(searchUrl.searchParams.get("start_date")!)).toBeLessThan(around.getTime());
  });

  it.each([["V", "REFUNDED"], ["P", "PENDING"], ["D", "DECLINED"]])("names Transaction Search's %s as %s", async (code, status) => {
    const fetcher = fetcherFor({
      "/v2/payments/captures/": [404, {}],
      "/v1/reporting/transactions": [200, { transaction_details: [{ transaction_info: { transaction_status: code, transaction_amount: { value: "70.00", currency_code: "USD" } } }] }],
    });
    expect((await newService({ fetcher }).getPayment("9AB12345CD678901E", around))?.status).toBe(status);
  });

  it("answers null when this PayPal account has no such payment", async () => {
    const fetcher = fetcherFor({ "/v2/payments/captures/": [404, {}], "/v1/reporting/transactions": [200, { transaction_details: [] }] });
    expect(await newService({ fetcher }).getPayment("9AB12345CD678901E", around)).toBeNull();
  });

  it("throws on a PayPal error, so it isn't read as 'no such payment'", async () => {
    const fetcher = fetcherFor({ "/v2/payments/captures/": [404, {}], "/v1/reporting/transactions": [403, { name: "NOT_AUTHORIZED" }] });
    await expect(newService({ fetcher }).getPayment("9AB12345CD678901E", around)).rejects.toThrow(/search failed \(403\)/);
  });

  it("never puts a malformed ID into a PayPal URL", async () => {
    const fetcher = fetcherFor({});
    expect(await newService({ fetcher }).getPayment("../v1/oauth2", around)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
