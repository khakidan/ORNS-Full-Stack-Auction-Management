/**
 * Node port of scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_PayPalService.gs -
 * a straight structural port (same methods, same request shapes), swapping
 * `UrlFetchApp.fetch` for Node's `fetch` and Script Properties for env vars.
 * See docs/agents/refactor-opportunities.md's Code Hardening item #2, Step 1.
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
      name: "Merchant Processing Surcharge Fee",
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
}
