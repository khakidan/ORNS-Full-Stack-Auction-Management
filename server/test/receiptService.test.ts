/**
 * server/services/receiptService.ts's processAllEmails (the "Email All
 * Winners" batch), run against stateful Sheets/Gmail/PayPal mocks.
 *
 * ROADMAP.md H3: the batch used to have no record of who had already been
 * emailed, so a retried or re-clicked batch emailed every bidder again,
 * and it re-read three full sheets per bidder. It now records each send
 * in Bidder-Numbers M/N and skips a bidder already emailed this same
 * invoice. ROADMAP.md H2: every email links the bidder's current invoice.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { server } from "./setup";
import { resetHandlersState } from "./handlers";
import { processAllEmails } from "../services/receiptService";
import { getAuthenticatedClient } from "../services/oauth";
import { PayPalService } from "../services/paypalService";
import { mockReceiptSheets } from "./helpers/receiptSheets";

const HEADER = ["ID", "First Name", "Last Name", "Email", "Checked In", "Proxy Bidder", "Checked Out", "Paid", "Payment Method", "Invoice URL", "Invoiced Amount"];

const BID_MANAGEMENT_ROWS = [
  ["101", "", "102", "", "103", "", "104", ""],
  ["f", "f", "f", "f", "f", "f", "f", "f"],
  ["f", "f", "f", "f", "f", "f", "f", "f"],
  ["801", "50", "802", "30", "803", "20", "804", "10"],
];

const AUCTION_ITEMS_ROWS = [
  ["Item Number", "Category", "Item Name"],
  ["801", "Food", "Pizza Night"],
  ["802", "Art", "Painting Class"],
  ["803", "Kids", "Pony Ride"],
  ["804", "Food", "Cookies"],
];

function bidderNumbers() {
  return [
    HEADER,
    ["101", "Alice", "One", "alice@example.com"],
    ["102", "Bob", "Two", "bob@example.com"],
    ["103", "Carol", "Three", "carol@example.com"],
  ];
}

const fakeClient = getAuthenticatedClient({
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000,
});
const paypal = () => new PayPalService({ isSandbox: true, clientId: "id", clientSecret: "secret" });

describe("processAllEmails", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it("emails every bidder with winning items their current invoice, and records each send in M/N", async () => {
    const mock = mockReceiptSheets({ bidderNumbers: bidderNumbers(), bidManagement: BID_MANAGEMENT_ROWS, auctionItems: AUCTION_ITEMS_ROWS });

    const result = await processAllEmails(fakeClient, "ss-id", "items-ss-id", paypal());

    expect(result).toEqual({ sentCount: 3, alreadySentCount: 0, failedCount: 0 });
    expect(mock.sentEmails.map((e) => e.to).sort()).toEqual(["alice@example.com", "bob@example.com", "carol@example.com"]);
    for (const row of mock.bidderNumbers.slice(1)) {
      expect(row[13]).toBe(row[9]); // emailed exactly the invoice now in Column J
      expect(row[12]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(mock.bidderNumbers[0].slice(12, 14)).toEqual(["Receipt Emailed At", "Receipt Emailed Invoice"]);
  });

  it("running the batch again sends nothing, creates no new invoices, and reports the skips (ROADMAP.md H3)", async () => {
    const mock = mockReceiptSheets({ bidderNumbers: bidderNumbers(), bidManagement: BID_MANAGEMENT_ROWS, auctionItems: AUCTION_ITEMS_ROWS });

    await processAllEmails(fakeClient, "ss-id", "items-ss-id", paypal());
    const second = await processAllEmails(fakeClient, "ss-id", "items-ss-id", paypal());

    expect(second).toEqual({ sentCount: 0, alreadySentCount: 3, failedCount: 0 });
    expect(mock.sentEmails).toHaveLength(3);
    expect(mock.invoicesCreated()).toBe(3);
  });

  it("re-sends to a bidder whose total changed since their last email (new invoice), and only to them", async () => {
    const mock = mockReceiptSheets({ bidderNumbers: bidderNumbers(), bidManagement: BID_MANAGEMENT_ROWS, auctionItems: AUCTION_ITEMS_ROWS });
    await processAllEmails(fakeClient, "ss-id", "items-ss-id", paypal());

    // Bob wins another item after the first batch.
    BID_MANAGEMENT_ROWS.push(["", "", "804", "15", "", "", "", ""]);
    try {
      const second = await processAllEmails(fakeClient, "ss-id", "items-ss-id", paypal());

      expect(second).toEqual({ sentCount: 1, alreadySentCount: 2, failedCount: 0 });
      expect(mock.sentEmails.slice(3).map((e) => e.to)).toEqual(["bob@example.com"]);
      expect(mock.bidderNumbers[2][13]).toBe(mock.bidderNumbers[2][9]);
    } finally {
      BID_MANAGEMENT_ROWS.pop();
    }
  });

  it("skips bidders with no or an invalid email address, without creating invoices for them", async () => {
    const rows = bidderNumbers();
    rows[2][3] = "";
    rows[3][3] = "carol@example.com\r\nBcc: attacker@evil.example";
    const mock = mockReceiptSheets({ bidderNumbers: rows, bidManagement: BID_MANAGEMENT_ROWS, auctionItems: AUCTION_ITEMS_ROWS });

    const result = await processAllEmails(fakeClient, "ss-id", "items-ss-id", paypal());

    expect(result.sentCount).toBe(1);
    expect(mock.sentEmails.map((e) => e.to)).toEqual(["alice@example.com"]);
    expect(mock.invoicesCreated()).toBe(1);
  });

  it("does not abort the batch when one bidder's email fails - the rest still go out", async () => {
    const mock = mockReceiptSheets({ bidderNumbers: bidderNumbers(), bidManagement: BID_MANAGEMENT_ROWS, auctionItems: AUCTION_ITEMS_ROWS });
    mock.failEmailsTo.add("bob@example.com");

    const result = await processAllEmails(fakeClient, "ss-id", "items-ss-id", paypal());

    expect(result).toEqual({ sentCount: 2, alreadySentCount: 0, failedCount: 1 });
    expect(mock.bidderNumbers[2][13]).toBe(""); // Bob not recorded as emailed, so a re-run tries him again
  });

  it("stops the batch if a send can't be recorded, so a re-run can't email those bidders twice", async () => {
    const mock = mockReceiptSheets({ bidderNumbers: bidderNumbers(), bidManagement: BID_MANAGEMENT_ROWS, auctionItems: AUCTION_ITEMS_ROWS });
    // Receipts go out sorted by last name - Alice One (row 2) first.
    mock.failWritesTo.add("!M2:N2");

    await expect(processAllEmails(fakeClient, "ss-id", "items-ss-id", paypal()))
      .rejects.toThrow(/Stopped emailing receipts after 1 sent: bidder 101's receipt was emailed but couldn't be recorded/);
    expect(mock.sentEmails.map((e) => e.to)).toEqual(["alice@example.com"]);
  });
});
