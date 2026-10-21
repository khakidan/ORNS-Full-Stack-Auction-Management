/**
 * server/services/emailService.ts - the single-bidder receipt email
 * (processEmail) and the email construction it shares with the batch.
 *
 * ROADMAP.md H2: the email must link the bidder's *current* PayPal
 * invoice and show that invoice's own amount - it used to link whatever
 * URL was cached in Column J (possibly for an old total, or already
 * cancelled) while computing "Pay $X" fresh.
 * ROADMAP.md H3: names, item names, and addresses come from sheet cells
 * staff and ticket buyers fill in, so the email headers must not be
 * injectable (CR/LF -> extra Bcc:), non-ASCII names must be encoded, and
 * the HTML body must be escaped.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { server } from "./setup";
import { resetHandlersState } from "./handlers";
import { processEmail, createRawEmail, generateEmailHtml } from "../services/emailService";
import { getAuthenticatedClient } from "../services/oauth";
import { PayPalService } from "../services/paypalService";
import { calculatePayPalSurcharge } from "../utils/financeUtils";
import { decodeRawEmail, mockReceiptSheets } from "./helpers/receiptSheets";

const HEADER = ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid", "Payment Method", "Invoice URL", "Invoiced Amount"];

// Column-pair bid grid: bidder IDs in the header row, two filler rows,
// then item/price pairs from row 3.
const BID_MANAGEMENT_ROWS = [
  ["101", "", "102", ""],
  ["filler", "filler", "filler", "filler"],
  ["filler", "filler", "filler", "filler"],
  ["item1", "$50.00", "", ""],
  ["item2", "$25.00", "", ""],
];

const AUCTION_ITEMS_ROWS = [
  ["Item Number", "Category", "Item Name"],
  ["item1", "Food", "Pizza Night"],
  ["item2", "Art", "Painting Class"],
];

const TOTAL_WITH_FEES = calculatePayPalSurcharge(75).total;

function bidderRow(overrides: Record<number, any> = {}) {
  const row: any[] = ["101", "Alice", "One", "alice@example.com", "", "", "", "", "", "", ""];
  Object.entries(overrides).forEach(([k, v]) => { row[Number(k)] = v; });
  return row;
}

const fakeClient = getAuthenticatedClient({
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000,
});
const paypal = () => new PayPalService({ isSandbox: true, clientId: "id", clientSecret: "secret" });

describe("emailService.processEmail", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it("creates the bidder's invoice, emails a link to it showing its own total, and records the send in M/N", async () => {
    const mock = mockReceiptSheets({ bidderNumbers: [HEADER, bidderRow()], bidManagement: BID_MANAGEMENT_ROWS, auctionItems: AUCTION_ITEMS_ROWS });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    expect(result).toEqual({ success: true });
    expect(mock.invoicesCreated()).toBe(1);
    const invoiceUrl = "https://www.sandbox.paypal.com/invoice/p/#INV2-MOCK-0000-0000-0001";
    expect(mock.bidderNumbers[1][9]).toBe(invoiceUrl);
    expect(mock.sentEmails).toHaveLength(1);
    expect(mock.sentEmails[0].to).toBe("alice@example.com");
    expect(mock.sentEmails[0].html).toContain(`href="${invoiceUrl}"`);
    expect(mock.sentEmails[0].html).toContain(`Pay $${TOTAL_WITH_FEES.toFixed(2)} via PayPal`);
    expect(mock.bidderNumbers[1][13]).toBe(invoiceUrl);
    expect(mock.bidderNumbers[1][12]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("replaces a stale Column J invoice (old total) instead of emailing a link to it (ROADMAP.md H2)", async () => {
    const staleUrl = "https://www.sandbox.paypal.com/invoice/p/#INV2-OLD0-0000-0000-0001";
    const mock = mockReceiptSheets({
      bidderNumbers: [HEADER, bidderRow({ 9: staleUrl, 10: calculatePayPalSurcharge(50).total })],
      bidManagement: BID_MANAGEMENT_ROWS,
      auctionItems: AUCTION_ITEMS_ROWS,
    });

    await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    expect(mock.invoicesCreated()).toBe(1);
    expect(mock.sentEmails[0].html).not.toContain(staleUrl);
    expect(mock.sentEmails[0].html).toContain("#INV2-MOCK-0000-0000-0001");
  });

  it("reuses a Column J invoice whose amount still matches, without creating another", async () => {
    const currentUrl = "https://www.sandbox.paypal.com/invoice/p/#INV2-CURR-0000-0000-0001";
    const mock = mockReceiptSheets({
      bidderNumbers: [HEADER, bidderRow({ 9: currentUrl, 10: TOTAL_WITH_FEES })],
      bidManagement: BID_MANAGEMENT_ROWS,
      auctionItems: AUCTION_ITEMS_ROWS,
    });

    await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    expect(mock.invoicesCreated()).toBe(0);
    expect(mock.sentEmails[0].html).toContain(`href="${currentUrl}"`);
  });

  it("returns a clean error when the bidder has no email on file, without creating an invoice", async () => {
    const mock = mockReceiptSheets({ bidderNumbers: [HEADER, bidderRow({ 3: "" })], bidManagement: BID_MANAGEMENT_ROWS, auctionItems: AUCTION_ITEMS_ROWS });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    expect(result).toEqual({ success: false, error: "No email address found for this bidder." });
    expect(mock.invoicesCreated()).toBe(0);
  });

  it("refuses an email cell holding more than one address, without creating an invoice or sending anything", async () => {
    const mock = mockReceiptSheets({
      bidderNumbers: [HEADER, bidderRow({ 3: "alice@example.com, attacker@evil.example" })],
      bidManagement: BID_MANAGEMENT_ROWS,
      auctionItems: AUCTION_ITEMS_ROWS,
    });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    expect(result.success).toBe(false);
    expect(mock.invoicesCreated()).toBe(0);
    expect(mock.sentEmails).toHaveLength(0);
  });

  it("returns a clean error when the bidder isn't in the Bid-Management matrix", async () => {
    mockReceiptSheets({ bidderNumbers: [HEADER, bidderRow()], bidManagement: [["999", "", "102", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]], auctionItems: AUCTION_ITEMS_ROWS });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    expect(result).toEqual({ success: false, error: "Bidder ID not found in matrix." });
  });

  it("returns a clean error when the bidder won no items", async () => {
    mockReceiptSheets({ bidderNumbers: [HEADER, bidderRow()], bidManagement: [["101", "", "102", ""], ["f", "f", "f", "f"], ["f", "f", "f", "f"]], auctionItems: AUCTION_ITEMS_ROWS });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    expect(result).toEqual({ success: false, error: "No items won." });
  });

  it("falls back to blank names instead of the literal string 'undefined'/'null' for a malformed Bidder-Numbers row", async () => {
    const mock = mockReceiptSheets({
      bidderNumbers: [HEADER, ["101", undefined as any, undefined as any, "alice@example.com"]],
      bidManagement: BID_MANAGEMENT_ROWS,
      auctionItems: AUCTION_ITEMS_ROWS,
    });

    const result = await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    expect(result).toEqual({ success: true });
    expect(mock.sentEmails[0].headers + mock.sentEmails[0].html).not.toMatch(/undefined|null/);
  });

  it("can't be made to add recipients through a line break in the bidder's name (ROADMAP.md H3)", async () => {
    const mock = mockReceiptSheets({
      bidderNumbers: [HEADER, bidderRow({ 2: "One\r\nBcc: attacker@evil.example" })],
      bidManagement: BID_MANAGEMENT_ROWS,
      auctionItems: AUCTION_ITEMS_ROWS,
    });

    await processEmail(fakeClient, "ss-id", "101", "items-ss-id", paypal());

    const headerLines = mock.sentEmails[0].headers.split("\r\n");
    expect(headerLines.some((line) => /^bcc:/i.test(line))).toBe(false);
    expect(headerLines.filter((line) => line.startsWith("Subject:"))).toHaveLength(1);
  });
});

describe("emailService - email construction (ROADMAP.md H3)", () => {
  it("RFC 2047-encodes a non-ASCII subject so names like José arrive intact", () => {
    const { headers } = decodeRawEmail(createRawEmail("jose@example.com", "Your Auction Receipt: José Núñez", "<p>hi</p>"));
    const subject = (headers.match(/^Subject: (.*)$/m) || [])[1];
    expect(subject).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const encoded = subject.slice("=?UTF-8?B?".length, -2);
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe("Your Auction Receipt: José Núñez");
  });

  it("leaves a plain-ASCII subject and quoted From name unchanged", () => {
    const { headers } = decodeRawEmail(createRawEmail("a@example.com", "Your Auction Receipt: Alice One", "<p>hi</p>", "Orchard Ridge Nursery School", "staff@orns.org"));
    expect(headers).toContain("Subject: Your Auction Receipt: Alice One");
    expect(headers).toContain('From: "Orchard Ridge Nursery School" <staff@orns.org>');
  });

  it("escapes names and item names in the HTML body", () => {
    const html = generateEmailHtml(
      { bidId: "101", firstName: "<b>Alice</b>", lastName: "One", itemsWon: ["item1"], itemNames: ['<img src=x onerror="alert(1)">'], itemPrices: [50], totalCost: 50 },
      "https://www.sandbox.paypal.com/invoice/p/#INV2-X",
      "52.25",
      "2.25"
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;b&gt;Alice&lt;/b&gt;");
  });

  it("never puts a non-http(s) link on the Pay button", () => {
    const html = generateEmailHtml(
      { bidId: "101", firstName: "Alice", lastName: "One", itemsWon: [], itemNames: [], itemPrices: [], totalCost: 0 },
      "javascript:alert(1)",
      "0.51",
      "0.51"
    );
    expect(html).toContain('href="#"');
    expect(html).not.toContain("javascript:");
  });
});
