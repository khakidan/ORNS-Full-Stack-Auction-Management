/**
 * FluentFormsApi: an entry's payments from WordPress's REST API (ROADMAP W4).
 * The response shape is Fluent Forms' `submissions/resources` with
 * `orderData` (OrderData::getSummary): transactions and refunds are rows of
 * its transactions table, totals in cents.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { FluentFormsApi, fluentFormsApiFromEnv } from "../services/fluentFormsApi";

const transaction = (overrides: Record<string, unknown> = {}) => ({
  id: 9, form_id: 7, submission_id: 1424, transaction_type: "onetime", payment_method: "paypal",
  charge_id: "9AB12345CD678901E", payment_total: 7000, status: "paid", currency: "USD",
  payer_email: "pat@example.com", created_at: "2026-04-25 12:05:02", ...overrides,
});

function api(body: unknown, status = 200) {
  const fetcher = vi.fn(async () => ({ status, text: async () => JSON.stringify(body) }) as Response);
  return { fetcher, client: new FluentFormsApi({ siteUrl: "https://www.orns.org/some/page", user: "orns-app", password: "abcd efgh ijkl", fetcher }) };
}

describe("FluentFormsApi.getEntryPayment", () => {
  it("reads the entry's order data, signed in with the Application Password", async () => {
    const { fetcher, client } = api({ orderData: { transactions: [transaction()], refunds: [] } });

    const payment = await client.getEntryPayment("1424");

    expect(payment.transactions).toEqual([{
      submissionId: "1424", formId: "7", paymentMethod: "paypal", status: "paid", chargeId: "9AB12345CD678901E",
      total: 70, currency: "USD", createdAt: "2026-04-25 12:05:02",
    }]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.orns.org/wp-json/fluentform/v1/submissions/resources?form_id=7&entry_id=1424&orderData=1");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("orns-app:abcd efgh ijkl").toString("base64")}`);
  });

  it("keeps only this form's transactions for this entry", async () => {
    const { client } = api({ orderData: { transactions: [transaction(), transaction({ form_id: 3 }), transaction({ submission_id: 99 })], refunds: [transaction({ status: "refunded" })] } });

    const payment = await client.getEntryPayment("1424");

    expect(payment.transactions).toHaveLength(1);
    expect(payment.refunds).toHaveLength(1);
  });

  it("answers an entry with no payment (no orderData) with empty lists", async () => {
    const { client } = api({});
    expect(await client.getEntryPayment("1424")).toEqual({ transactions: [], refunds: [] });
  });

  it("throws on a refusal, so the caller reports it rather than reading it as unpaid", async () => {
    const { client } = api({ code: "rest_forbidden" }, 401);
    await expect(client.getEntryPayment("1424")).rejects.toThrow("Fluent Forms API 401");
  });

  it("refuses an entry ID that isn't a number before calling WordPress", async () => {
    const { fetcher, client } = api({});
    await expect(client.getEntryPayment("1424&form_id=3")).rejects.toThrow("Not a Fluent Forms entry ID");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a site address that isn't https - the password would travel in the clear", () => {
    expect(() => new FluentFormsApi({ siteUrl: "http://www.orns.org", user: "u", password: "p" })).toThrow("https://");
  });
});

describe("fluentFormsApiFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of ["FLUENT_FORMS_SITE_URL", "FLUENT_FORMS_API_USER", "FLUENT_FORMS_API_PASSWORD", "FLUENT_FORMS_TICKETS_FORM_ID"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("is off until the site, user and password are all set", () => {
    process.env.FLUENT_FORMS_SITE_URL = "https://www.orns.org";
    process.env.FLUENT_FORMS_API_USER = "orns-app";
    delete process.env.FLUENT_FORMS_API_PASSWORD;
    expect(fluentFormsApiFromEnv()).toBeNull();

    process.env.FLUENT_FORMS_API_PASSWORD = "abcd";
    expect(fluentFormsApiFromEnv()?.formId).toBe("7");
  });
});
