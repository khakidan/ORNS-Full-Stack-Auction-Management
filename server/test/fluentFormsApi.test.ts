/**
 * FluentFormsApi: an entry's payments from WordPress's REST API (ROADMAP W4).
 * The response shape is Fluent Forms' `submissions/resources` with
 * `orderData` (OrderData::getSummary): transactions and refunds are rows of
 * its transactions table, totals in cents.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { FluentFormsApi, fluentFormsApiFromEnv, purchaseFromEntry, FluentFormsEntry } from "../services/fluentFormsApi";

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

/** An entries-list row as `GET submissions` returns it: `response` is JSON text, money in cents. */
const listed = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, form_id: "7", serial_number: String(id - 1280), status: "unread", payment_status: "pending", payment_method: "paypal",
  payment_total: "7000", currency: "USD", created_at: "2027-02-01 10:00:00",
  response: JSON.stringify({ names: { first_name: "Pat", last_name: "Lee" }, email: "pat@example.com", phone: "555-0100", payment_input: "2" }),
  ...overrides,
});

/** A list endpoint over `rows` (newest first), `perPage` at a time. */
function listApi(rows: ReturnType<typeof listed>[]) {
  const sorted = [...rows].sort((a, b) => b.id - a.id);
  const fetcher = vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    const perPage = Number(q.get("per_page")), page = Number(q.get("page"));
    const body = { data: sorted.slice((page - 1) * perPage, page * perPage), last_page: Math.max(1, Math.ceil(sorted.length / perPage)), total: sorted.length };
    return { status: 200, text: async () => JSON.stringify(body) } as Response;
  });
  return { fetcher, client: new FluentFormsApi({ siteUrl: "https://www.orns.org", user: "u", password: "p", fetcher }) };
}

describe("FluentFormsApi.listEntriesAfter", () => {
  it("pages back from the newest until it reaches the given entry, and answers oldest first", async () => {
    const { fetcher, client } = listApi([1478, 1479, 1480, 1481, 1482, 1483].map((id) => listed(id)));

    const entries = await client.listEntriesAfter(1479, 2);

    expect(entries.map((e) => e.id)).toEqual([1480, 1481, 1482, 1483]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(entries[0]).toMatchObject({ formId: "7", status: "unread", paymentMethod: "paypal", paymentStatus: "pending", total: 70 });
    expect(entries[0].response).toMatchObject({ names: { first_name: "Pat" }, payment_input: "2" });
  });

  it("stops at the last page", async () => {
    const { fetcher, client } = listApi([listed(1481), listed(1482)]);
    expect((await client.listEntriesAfter(0, 100)).map((e) => e.id)).toEqual([1481, 1482]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("asks for this form, newest first", async () => {
    const { fetcher, client } = listApi([listed(1481)]);
    await client.listEntriesAfter(0);
    const q = new URL(fetcher.mock.calls[0][0] as string).searchParams;
    expect([q.get("form_id"), q.get("sort_by")]).toEqual(["7", "DESC"]);
  });

  it("drops another form's entries", async () => {
    const { client } = listApi([listed(1481), listed(1482, { form_id: "3" })]);
    expect((await client.listEntriesAfter(0)).map((e) => e.id)).toEqual([1481]);
  });

  it("reads the newest entry's ID", async () => {
    expect(await listApi([listed(1481), listed(1482)]).client.latestEntryId()).toBe(1482);
    expect(await listApi([]).client.latestEntryId()).toBe(0);
  });
});

describe("purchaseFromEntry", () => {
  const entry = (response: Record<string, unknown>, overrides: Partial<FluentFormsEntry> = {}): FluentFormsEntry => ({
    id: 1482, formId: "7", status: "unread", paymentMethod: "test", paymentStatus: "pending", total: 70, createdAt: "", response, ...overrides,
  });

  it("reads the form's own field names, as the webhook would have", () => {
    const purchase = purchaseFromEntry(entry({
      names: { first_name: "Pat", last_name: "Lee" }, email: "pat@example.com", phone: "(123) 456-7890", payment_input: "2",
      guest_tickets: "true", number_of_guests: "1",
      guest_1_names: { first_name: "Sam", last_name: "Lee" }, guest_1_email: "sam@example.com", guest1_input_radio: "yes",
    }));

    expect(purchase).toMatchObject({
      entryId: "1482", firstName: "Pat", lastName: "Lee", email: "pat@example.com", phone: "(123) 456-7890",
      tickets: 2, paymentMethod: "test", paymentStatus: "pending", total: 70,
    });
    if ("error" in purchase) throw new Error(purchase.error);
    expect(purchase.guests[0]).toEqual({ firstName: "Sam", lastName: "Lee", email: "sam@example.com", ownBidderNumber: true });
    expect(purchase.guests.slice(1).every((g) => !g.firstName && !g.email)).toBe(true);
  });

  it("reads guests 2 and 3's own-number answers from guest2_input_radio and guest3_input_radio", () => {
    const purchase = purchaseFromEntry(entry({
      names: { first_name: "Pat", last_name: "Lee" }, payment_input: "3",
      guest_2_names: { first_name: "Jo", last_name: "Lee" }, guest2_input_radio: "no",
      guest_3_names: { first_name: "Ari", last_name: "Lee" }, guest3_input_radio: "yes",
    }));
    expect("error" in purchase ? null : purchase.guests.map((g) => g.ownBidderNumber)).toEqual([false, false, true]);
  });

  it("copes with missing fields - the row builder (W2) decides what needs review", () => {
    const purchase = purchaseFromEntry(entry({}));
    expect(purchase).toMatchObject({ entryId: "1482", firstName: "", tickets: NaN });
  });
});
