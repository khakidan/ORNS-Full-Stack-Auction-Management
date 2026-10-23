import { describe, it, expect } from "vitest";
import { BIDDER_COL, ITEM_COL } from "../utils/sheetColumns";
import { BIDDER_NUMBERS_HEADERS } from "../utils/bidderNumbersHeaders";

describe("sheetColumns", () => {
  it("BIDDER_COL points at the matching header in the row the sync writes", () => {
    const expected: Record<keyof typeof BIDDER_COL, string> = {
      id: "ID", firstName: "First Name", lastName: "Last Name", email: "Email",
      checkedIn: "Checked In", proxy: "Proxy Bidder", checkedOut: "Checked Out", paid: "Paid",
      paymentMethod: "Payment Method", invoiceUrl: "Invoice URL", invoicedAmount: "Invoiced Amount",
      paypalPendingSince: "PayPal Pending Since", receiptEmailedAt: "Receipt Emailed At", receiptEmailedInvoice: "Receipt Emailed Invoice",
    };
    for (const [field, header] of Object.entries(expected)) {
      expect(BIDDER_NUMBERS_HEADERS[BIDDER_COL[field as keyof typeof BIDDER_COL]]).toBe(header);
    }
    expect(Object.keys(BIDDER_COL)).toHaveLength(BIDDER_NUMBERS_HEADERS.length);
  });

  it("ITEM_COL covers columns A-M once each", () => {
    expect(Object.values(ITEM_COL).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
