import { purchaseFromWebhook } from "./fluentFormsWebhookPayload";
import { TicketPurchase } from "./ticketPurchaseRow";

/**
 * Reads the "Auction Tickets" form's entries from WordPress's REST API
 * (Fluent Forms' `fluentform/v1` routes) - what the ticket webhook can't
 * send: the payment's PayPal transaction ID (ROADMAP W4), and the entries
 * themselves for the poll (W5).
 *
 * Signs in as a dedicated WordPress user with an Application Password
 * (Basic auth), set in these env vars - with any of them unset the API
 * isn't used:
 *
 *   FLUENT_FORMS_SITE_URL       https://www.orns.org
 *   FLUENT_FORMS_API_USER       the WordPress user's login
 *   FLUENT_FORMS_API_PASSWORD   its Application Password (from Secret Manager)
 *   FLUENT_FORMS_TICKETS_FORM_ID  optional, default 7
 */

/** One row of Fluent Forms' transactions table, as the app uses it. */
export interface FluentFormsTransaction {
  submissionId: string;
  formId: string;
  /** "paypal", "test" (cash/check), ... */
  paymentMethod: string;
  /** "paid", "pending", "refunded", "partially-refunded", ... */
  status: string;
  /** The payment's ID at PayPal (Fluent Forms calls it charge_id); staff can edit it in WordPress, so it's only a lead. */
  chargeId: string;
  /** Dollars (Fluent Forms stores cents). */
  total: number;
  currency: string;
  createdAt: string;
}

export interface FluentFormsEntryPayment {
  transactions: FluentFormsTransaction[];
  refunds: FluentFormsTransaction[];
}

/** One entry of the form, from the entries list (W5). */
export interface FluentFormsEntry {
  id: number;
  formId: string;
  /** "unread", "read", "spam" (trashed entries aren't listed). */
  status: string;
  /** "paypal", "test" (cash/check), ... */
  paymentMethod: string;
  /** "paid", "pending", "refunded", ... - Fluent Forms' word, never trusted for Paid (W4). */
  paymentStatus: string;
  /** Dollars (Fluent Forms stores cents). */
  total: number;
  createdAt: string;
  /** The submitted fields, keyed by the form's input names (names, email, payment_input, guest_1_names, ...). */
  response: Record<string, unknown>;
}

export interface FluentFormsApiOptions {
  siteUrl: string;
  user: string;
  password: string;
  formId?: string;
  fetcher?: typeof fetch;
}

const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value).trim());

function transactionFrom(raw: any): FluentFormsTransaction {
  return {
    submissionId: str(raw?.submission_id),
    formId: str(raw?.form_id),
    paymentMethod: str(raw?.payment_method).toLowerCase(),
    status: str(raw?.status).toLowerCase(),
    chargeId: str(raw?.charge_id),
    total: Number(raw?.payment_total) / 100,
    currency: str(raw?.currency).toUpperCase(),
    createdAt: str(raw?.created_at),
  };
}

export class FluentFormsApi {
  readonly formId: string;
  private baseUrl: string;
  private authorization: string;
  private fetcher: typeof fetch;

  constructor({ siteUrl, user, password, formId = "7", fetcher = fetch }: FluentFormsApiOptions) {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:") throw new Error("FLUENT_FORMS_SITE_URL must start with https://");
    this.baseUrl = `${url.origin}/wp-json/fluentform/v1`;
    this.authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    this.formId = formId;
    this.fetcher = fetcher;
  }

  /**
   * An entry's payments and refunds (`GET submissions/resources` with
   * `orderData`, what the entry's page in WordPress shows). Only this
   * form's transactions for this entry are kept - the endpoint answers
   * for whichever form the entry is on.
   */
  async getEntryPayment(entryId: string): Promise<FluentFormsEntryPayment> {
    if (!/^\d+$/.test(entryId)) throw new Error(`Not a Fluent Forms entry ID: ${entryId}`);
    const query = new URLSearchParams({ form_id: this.formId, entry_id: entryId, orderData: "1" });
    const response = await this.fetcher(`${this.baseUrl}/submissions/resources?${query}`, {
      method: "GET",
      headers: { Authorization: this.authorization, Accept: "application/json" },
    });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`Fluent Forms API ${response.status}: ${text.slice(0, 300)}`);
    const order = JSON.parse(text)?.orderData || {};
    const ours = (t: FluentFormsTransaction) => t.submissionId === entryId && t.formId === this.formId;
    return {
      transactions: (Array.isArray(order.transactions) ? order.transactions : []).map(transactionFrom).filter(ours),
      refunds: (Array.isArray(order.refunds) ? order.refunds : []).map(transactionFrom).filter(ours),
    };
  }

  /**
   * Every entry of the form newer than `afterId`, oldest first (spam
   * included - the caller decides; trashed ones aren't listed). The list
   * endpoint (`GET submissions`) has no "after ID" filter, so this pages
   * back from the newest until it reaches `afterId`.
   */
  async listEntriesAfter(afterId: number, perPage = 100): Promise<FluentFormsEntry[]> {
    const found = new Map<number, FluentFormsEntry>();
    for (let page = 1; page <= 100; page++) {
      const query = new URLSearchParams({ form_id: this.formId, per_page: String(perPage), page: String(page), sort_by: "DESC" });
      const response = await this.fetcher(`${this.baseUrl}/submissions?${query}`, {
        method: "GET",
        headers: { Authorization: this.authorization, Accept: "application/json" },
      });
      const text = await response.text();
      if (response.status !== 200) throw new Error(`Fluent Forms API ${response.status}: ${text.slice(0, 300)}`);
      const data = JSON.parse(text);
      const entries = (Array.isArray(data?.data) ? data.data : []).map(entryFrom).filter((e: FluentFormsEntry) => e.formId === this.formId && Number.isInteger(e.id));
      const newer = entries.filter((e: FluentFormsEntry) => e.id > afterId);
      for (const e of newer) found.set(e.id, e);
      if (newer.length === 0 || page >= Number(data?.last_page || 1)) break;
    }
    return [...found.values()].sort((a, b) => a.id - b.id);
  }

  /** The newest entry's ID, or 0 when the form has none. */
  async latestEntryId(): Promise<number> {
    const query = new URLSearchParams({ form_id: this.formId, per_page: "1", page: "1", sort_by: "DESC" });
    const response = await this.fetcher(`${this.baseUrl}/submissions?${query}`, {
      method: "GET",
      headers: { Authorization: this.authorization, Accept: "application/json" },
    });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`Fluent Forms API ${response.status}: ${text.slice(0, 300)}`);
    const first = JSON.parse(text)?.data?.[0];
    return first ? Number(first.id) || 0 : 0;
  }
}

function entryFrom(raw: any): FluentFormsEntry {
  let response: unknown = raw?.response;
  if (typeof response === "string") {
    try {
      response = JSON.parse(response);
    } catch {
      response = {};
    }
  }
  return {
    id: Number(raw?.id),
    formId: str(raw?.form_id),
    status: str(raw?.status).toLowerCase(),
    paymentMethod: str(raw?.payment_method).toLowerCase(),
    paymentStatus: str(raw?.payment_status).toLowerCase(),
    total: Number(raw?.payment_total) / 100,
    createdAt: str(raw?.created_at),
    response: response && typeof response === "object" && !Array.isArray(response) ? (response as Record<string, unknown>) : {},
  };
}

const nameOf = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/**
 * An entry as a TicketPurchase - by way of the webhook's body, so the poll
 * reads an entry exactly as the webhook does. The keys are the form's own
 * input names (`fluentform-get-form` lists them); each guest's "own bidder
 * number" answer is `guestN_input_radio`.
 */
export function purchaseFromEntry(entry: FluentFormsEntry): TicketPurchase | { error: string } {
  const r = entry.response;
  const names = nameOf(r.names);
  const body: Record<string, unknown> = {
    entry_id: entry.id,
    first_name: names.first_name,
    last_name: names.last_name,
    email: r.email,
    phone: r.phone,
    tickets: r.payment_input,
    payment_method: entry.paymentMethod,
    payment_status: entry.paymentStatus,
    payment_total: entry.total,
  };
  for (const n of [1, 2, 3]) {
    const guest = nameOf(r[`guest_${n}_names`]);
    body[`guest_${n}_first_name`] = guest.first_name;
    body[`guest_${n}_last_name`] = guest.last_name;
    body[`guest_${n}_email`] = r[`guest_${n}_email`];
    body[`guest_${n}_own_number`] = r[`guest${n}_input_radio`];
  }
  return purchaseFromWebhook(body);
}

/** The API from the env vars above, or null while any of them is unset. */
export function fluentFormsApiFromEnv(fetcher?: typeof fetch): FluentFormsApi | null {
  const siteUrl = process.env.FLUENT_FORMS_SITE_URL?.trim();
  const user = process.env.FLUENT_FORMS_API_USER?.trim();
  const password = process.env.FLUENT_FORMS_API_PASSWORD?.trim();
  if (!siteUrl || !user || !password) return null;
  return new FluentFormsApi({ siteUrl, user, password, formId: process.env.FLUENT_FORMS_TICKETS_FORM_ID?.trim() || "7", fetcher });
}
