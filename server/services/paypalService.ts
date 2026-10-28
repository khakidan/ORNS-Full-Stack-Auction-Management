/**
 * Node port of scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/not-deployed/Class_PayPalService.gs -
 * a straight structural port (same methods, same request shapes), swapping
 * `UrlFetchApp.fetch` for Node's `fetch` and Script Properties for env vars.
 * See docs/agents/CHANGELOG.md's Code Hardening item #2, Step 1.
 *
 * Deliberately NOT ported: `calculatePayPalSurcharge` - `financeUtils.ts`
 * already has an identical copy; that stays the one implementation.
 */

export interface PayPalServiceOverrides {
  fetcher?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
  isSandbox?: boolean;
}

export interface PayPalLineItem {
  name: string;
  amount: number;
}

export interface PayPalBidderInfo {
  email: string;
  firstName: string;
  lastName: string;
  id: string | number;
}

export interface PayPalInvoiceResult {
  invoiceId: string;
  totalAmount: number;
  checkoutUrl: string;
}

import { calculatePayPalSurcharge } from "../utils/financeUtils";

/**
 * Invoice statuses that mean the bidder owes nothing more: PAID (paid
 * through PayPal) and MARKED_AS_PAID (a payment recorded by hand, e.g. in
 * the PayPal dashboard). Checkout and the sweeper both use this, so they
 * never disagree about whether an invoice is settled (ROADMAP.md L2).
 */
export function isPaidInvoiceStatus(status: string): boolean {
  return status === "PAID" || status === "MARKED_AS_PAID";
}

/** The invoice line createAndSendInvoice adds for the card surcharge. */
export const SURCHARGE_LINE_NAME = "Merchant Processing Surcharge Fee";

export interface RemoveSurchargeResult {
  /** The invoice's status when it was read (before any change). */
  status: string;
  /** The invoice's total after the surcharge line is gone - what a cash/check payment should be recorded at. */
  total: number;
  /** False when there was no surcharge line to remove (nothing was changed). */
  removed: boolean;
}

/** One PayPal payment as PayPal itself reports it (getPayment). */
export interface PayPalPayment {
  /** COMPLETED, PENDING, REFUNDED, PARTIALLY_REFUNDED, DECLINED, ... */
  status: string;
  amount: number;
  currency: string;
  /** Why a PENDING payment is pending (Captures API only), e.g. PENDING_REVIEW - PayPal holding it for a risk review - or ECHECK. */
  pendingReason?: string;
}

/** Transaction Search's one-letter statuses, as the Captures API names them. */
const SEARCH_STATUSES: Record<string, string> = { S: "COMPLETED", P: "PENDING", V: "REFUNDED", D: "DECLINED" };
const DAY_MS = 24 * 60 * 60 * 1000;

export class PayPalService {
  private fetcher: typeof fetch;
  private clientId: string;
  private clientSecret: string;
  private isSandbox: boolean;
  private baseUrl: string;
  private merchantEmail: string;

  constructor(overrides: PayPalServiceOverrides = {}) {
    this.fetcher = overrides.fetcher || fetch;

    this.clientId = (overrides.clientId !== undefined
      ? overrides.clientId
      : (process.env.PAYPAL_CLIENT_ID || "")
    ).trim();
    this.clientSecret = (overrides.clientSecret !== undefined
      ? overrides.clientSecret
      : (process.env.PAYPAL_CLIENT_SECRET || "")
    ).trim();

    if (overrides.isSandbox !== undefined) {
      this.isSandbox = overrides.isSandbox;
    } else {
      const sandboxRaw = (process.env.PAYPAL_IS_SANDBOX || "").trim().toLowerCase();
      this.isSandbox = sandboxRaw === "true" || sandboxRaw === "";
    }

    this.baseUrl = this.isSandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    this.merchantEmail = "pavetheway@orns.org";
  }

  private async getAccessToken_(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Missing PayPal credentials in your environment variables!");
    }
    const authString = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

    const response = await this.fetcher(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authString}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (response.status !== 200) {
      throw new Error(`PayPal API Authentication Failed: ${await response.text()}`);
    }
    const data = await response.json();
    return data.access_token;
  }

  /**
   * Parses the PayPal Invoice ID out of a checkout URL stored in Column J.
   * See Class_PayPalService.gs's `extractInvoiceIdFromUrl` for the full
   * rationale (sandbox's "inv-" vs production's "INV2-" prefix).
   */
  extractInvoiceIdFromUrl(url: string | null | undefined): string | null {
    if (!url || typeof url !== "string") return null;

    let fragment: string | null = null;

    const hashIndex = url.indexOf("#");
    if (hashIndex !== -1) {
      const raw = url.substring(hashIndex + 1).trim();
      if (raw.length > 0) fragment = raw;
    }

    if (!fragment) {
      const parts = url.split("/").filter((p) => p.length > 0);
      fragment = parts.length > 0 ? parts[parts.length - 1] : null;
    }

    if (!fragment) return null;

    if (/^inv-/i.test(fragment) && !/^inv2-/i.test(fragment)) {
      return "INV2-" + fragment.substring(4);
    }

    return fragment;
  }

  /**
   * Builds an active invoice on PayPal with one line per winning item, appends
   * the processing surcharge as its own line, sends it, and returns the payment link.
   */
  async createAndSendInvoice(bidderInfo: PayPalBidderInfo, lineItems: PayPalLineItem[]): Promise<PayPalInvoiceResult> {
    if (!bidderInfo || !bidderInfo.email) {
      throw new Error("createAndSendInvoice: bidderInfo must include an email address.");
    }
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      throw new Error("createAndSendInvoice: lineItems must be a non-empty array.");
    }

    const token = await this.getAccessToken_();

    const bidAmount = lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const feeData = calculatePayPalSurcharge(bidAmount);

    const invoiceItems = lineItems.map((item) => ({
      name: item.name,
      quantity: "1",
      unit_amount: { currency_code: "USD", value: Number(item.amount).toFixed(2) },
    }));

    invoiceItems.push({
      name: SURCHARGE_LINE_NAME,
      quantity: "1",
      unit_amount: { currency_code: "USD", value: feeData.surcharge.toFixed(2) },
    });

    const invoicePayload = {
      detail: {
        currency_code: "USD",
        reference: `Bidder #${bidderInfo.id}`,
        note: "Thank you for supporting our school charity auction! A standard merchant processing fee has been added to ensure 100% of your winning bids go directly to our programs.",
      },
      invoicer: { email_address: this.merchantEmail },
      primary_recipients: [
        {
          billing_info: {
            name: {
              given_name: bidderInfo.firstName,
              surname: bidderInfo.lastName,
            },
            email_address: bidderInfo.email,
            additional_info: `Bidder ID: ${bidderInfo.id}`,
          },
        },
      ],
      items: invoiceItems,
    };

    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // Step A: Draft the invoice
    let response = await this.fetcher(`${this.baseUrl}/v2/invoicing/invoices`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(invoicePayload),
    });
    const responseText = await response.text();
    let invoiceData: any = {};
    try {
      invoiceData = JSON.parse(responseText);
    } catch {
      // fall through to the missing-invoiceId error below
    }

    let invoiceId = invoiceData.id;
    if (!invoiceId && invoiceData.href) {
      const parts = invoiceData.href.split("/");
      invoiceId = parts[parts.length - 1];
    }

    if (!invoiceId) {
      throw new Error(`Invoice failed to build. Status: ${response.status}, Body: ${responseText}`);
    }

    // Step B: Send/publish so it registers on the payment ledger
    response = await this.fetcher(`${this.baseUrl}/v2/invoicing/invoices/${invoiceId}/send`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ send_to_recipient: true }),
    });

    // Step C: Extract the checkout URL
    let sendData: any = {};
    try {
      sendData = JSON.parse(await response.text());
    } catch {
      // PayPal sometimes returns an empty body on 202/204
    }

    const payerLink = sendData.links ? sendData.links.find((l: any) => l.rel === "payer-action") : null;
    const checkoutUrl = payerLink
      ? payerLink.href
      : this.isSandbox
        ? `https://www.sandbox.paypal.com/invoice/p/#${invoiceId}`
        : `https://www.paypal.com/invoice/p/#${invoiceId}`;

    return {
      invoiceId,
      totalAmount: feeData.total,
      checkoutUrl,
    };
  }

  /**
   * Destroys an existing outdated invoice link to prevent accidental underpayment.
   */
  async cancelInvoice(invoiceId: string): Promise<void> {
    const token = await this.getAccessToken_();
    await this.fetcher(`${this.baseUrl}/v2/invoicing/invoices/${invoiceId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Invoice Updated",
        note: "Your item cart balance changed. This old link has been disabled and replaced with an updated one.",
        send_to_recipient: false,
      }),
    });
  }

  /**
   * Takes the card-surcharge line off an invoice, for a bidder paying by
   * cash or check - they don't owe the surcharge, so the invoice should
   * total just their winning bids, and recording that amount leaves no
   * balance (ROADMAP.md L3).
   *
   * PayPal's update is a full replace (PUT): the current invoice is read,
   * the surcharge line dropped, and the whole invoice sent back. Fields
   * PayPal computes itself (totals, amount due, links, payments) are left
   * out so it recalculates them from the remaining lines. Neither the
   * bidder nor the merchant is emailed about the change.
   *
   * Does nothing to an invoice that's already paid (the caller decides
   * what to do) or that has no surcharge line.
   */
  async removeSurchargeLine(invoiceId: string): Promise<RemoveSurchargeResult> {
    if (!invoiceId) throw new Error("Invoice ID is required to remove the surcharge.");
    const token = await this.getAccessToken_();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const url = `${this.baseUrl}/v2/invoicing/invoices/${invoiceId}`;

    const getResponse = await this.fetcher(url, { method: "GET", headers });
    const getText = await getResponse.text();
    if (getResponse.status !== 200) {
      throw new Error(`PayPal invoice lookup failed (${getResponse.status}): ${getText}`);
    }
    const invoice = JSON.parse(getText);
    const status = String(invoice.status || "");
    const items: any[] = Array.isArray(invoice.items) ? invoice.items : [];
    const lineTotal = (lines: any[]) =>
      Math.round(lines.reduce((sum, item) => sum + (parseFloat(item?.unit_amount?.value) || 0) * (parseFloat(item?.quantity) || 1), 0) * 100) / 100;

    const kept = items.filter((item) => item?.name !== SURCHARGE_LINE_NAME);
    if (isPaidInvoiceStatus(status) || kept.length === items.length) {
      return { status, total: parseFloat(invoice.amount?.value) || lineTotal(items), removed: false };
    }
    if (kept.length === 0) {
      throw new Error(`Invoice ${invoiceId} has no lines besides the surcharge; left unchanged.`);
    }

    const { links, amount, due_amount, payments, refunds, ...rest } = invoice;
    const putResponse = await this.fetcher(`${url}?send_to_recipient=false&send_to_invoicer=false`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ...rest, items: kept }),
    });
    if (putResponse.status !== 200) {
      throw new Error(`PayPal invoice update failed (${putResponse.status}): ${await putResponse.text()}`);
    }
    return { status, total: lineTotal(kept), removed: true };
  }

  /**
   * Internal ledger tool to process offline cash/check payments.
   */
  async recordOfflinePayment(invoiceId: string, paymentMethod: string, totalAmount: number): Promise<boolean> {
    let apiInvoiceId = invoiceId ? invoiceId.trim() : "";
    if (apiInvoiceId && !apiInvoiceId.toUpperCase().startsWith("INV2-") && apiInvoiceId.length === 16) {
      const chunks = apiInvoiceId.match(/.{1,4}/g);
      if (chunks && chunks.length === 4) {
        apiInvoiceId = "INV2-" + chunks.join("-").toUpperCase();
      }
    }

    const token = await this.getAccessToken_();

    const payload = {
      method: paymentMethod.toUpperCase(),
      payment_date: new Date().toISOString().split("T")[0],
      amount: {
        currency_code: "USD",
        value: Number(totalAmount).toFixed(2),
      },
    };

    const response = await this.fetcher(`${this.baseUrl}/v2/invoicing/invoices/${apiInvoiceId}/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return response.status === 200 || response.status === 202 || response.status === 204;
  }

  /**
   * Fetches the current live status of an invoice directly from the PayPal API.
   */
  async getInvoiceStatus(invoiceId: string): Promise<string> {
    if (!invoiceId) throw new Error("Invoice ID is required to fetch status.");

    const accessToken = await this.getAccessToken_();
    const response = await this.fetcher(`${this.baseUrl}/v2/invoicing/invoices/${invoiceId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const responseText = await response.text();
    if (response.status !== 200) {
      throw new Error(`PayPal Live Lookup Failed (${response.status}): ${responseText}`);
    }

    const data = JSON.parse(responseText);
    return data.status;
  }

  /**
   * Looks up a payment by its PayPal transaction ID, as PayPal reports it -
   * how a website ticket purchase is confirmed paid (ROADMAP W4), never
   * from what the form says. null when this PayPal account has no such
   * payment.
   *
   * Tries the Captures API first (PayPal Checkout payments); a PayPal
   * Standard payment isn't a capture there, so a 404 falls back to
   * Transaction Search, which needs a date window of at most 31 days -
   * `around` is when the payment was made (a margin either side allows for
   * time zones). Transaction Search can lag a new payment by a few hours;
   * the poll (W5) checks again.
   */
  async getPayment(transactionId: string, around: Date): Promise<PayPalPayment | null> {
    if (!/^[A-Za-z0-9-]{6,64}$/.test(transactionId)) return null;
    const accessToken = await this.getAccessToken_();
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    const capture = await this.fetcher(`${this.baseUrl}/v2/payments/captures/${transactionId}`, { method: "GET", headers });
    if (capture.status === 200) {
      const data = JSON.parse(await capture.text());
      const pendingReason = data.status_details?.reason ? String(data.status_details.reason) : undefined;
      return { status: String(data.status || ""), amount: Number(data.amount?.value), currency: String(data.amount?.currency_code || ""), ...(pendingReason ? { pendingReason } : {}) };
    }
    if (capture.status !== 404) throw new Error(`PayPal payment lookup failed (${capture.status}): ${await capture.text()}`);

    const when = Number.isNaN(around.getTime()) ? Date.now() : around.getTime();
    const start = new Date(when - 2 * DAY_MS);
    const end = new Date(Math.min(when + 29 * DAY_MS, Date.now()));
    const query = new URLSearchParams({
      transaction_id: transactionId,
      start_date: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
      end_date: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
      fields: "transaction_info",
    });
    const search = await this.fetcher(`${this.baseUrl}/v1/reporting/transactions?${query}`, { method: "GET", headers });
    const text = await search.text();
    if (search.status !== 200) throw new Error(`PayPal transaction search failed (${search.status}): ${text}`);
    const info = JSON.parse(text).transaction_details?.[0]?.transaction_info;
    if (!info) return null;
    const code = String(info.transaction_status || "");
    return {
      status: SEARCH_STATUSES[code] || code,
      amount: Number(info.transaction_amount?.value),
      currency: String(info.transaction_amount?.currency_code || ""),
    };
  }
}
