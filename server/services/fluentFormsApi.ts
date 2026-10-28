/**
 * Reads the "Auction Tickets" form's entries from WordPress's REST API
 * (Fluent Forms' `fluentform/v1` routes) - what the ticket webhook can't
 * send: the payment's PayPal transaction ID (ROADMAP W4), and later the
 * entries themselves for the poll (W5).
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
}

/** The API from the env vars above, or null while any of them is unset. */
export function fluentFormsApiFromEnv(fetcher?: typeof fetch): FluentFormsApi | null {
  const siteUrl = process.env.FLUENT_FORMS_SITE_URL?.trim();
  const user = process.env.FLUENT_FORMS_API_USER?.trim();
  const password = process.env.FLUENT_FORMS_API_PASSWORD?.trim();
  if (!siteUrl || !user || !password) return null;
  return new FluentFormsApi({ siteUrl, user, password, formId: process.env.FLUENT_FORMS_TICKETS_FORM_ID?.trim() || "7", fetcher });
}
