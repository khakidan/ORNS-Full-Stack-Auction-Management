import { describe, it, expect } from "vitest";
import { BIDDER_COL, ITEM_COL, TICKETS_COL } from "../utils/sheetColumns";
import { getColumnLetter } from "../utils/columnUtils";
import { paymentColumnsForSheet } from "../../src/lib/attendeeSheetColumns";
import { BIDDER_NUMBERS_HEADERS } from "../utils/bidderNumbersHeaders";

describe("sheetColumns", () => {
  it("BIDDER_COL points at the matching header in the row the sync writes", () => {
    const expected: Record<keyof typeof BIDDER_COL, string> = {
      id: "ID", firstName: "First Name", lastName: "Last Name", email: "Email",
      checkedIn: "Checked In", proxy: "Proxy Bidder", checkedOut: "Checked Out", paid: "Paid",
      paymentMethod: "Payment Method", invoiceUrl: "Invoice URL", invoicedAmount: "Invoiced Amount",
      paypalPendingSince: "PayPal Pending Since", receiptEmailedAt: "Receipt Emailed At", receiptEmailedInvoice: "Receipt Emailed Invoice", ticketRef: "Ticket",
    };
    for (const [field, header] of Object.entries(expected)) {
      expect(BIDDER_NUMBERS_HEADERS[BIDDER_COL[field as keyof typeof BIDDER_COL]]).toBe(header);
    }
    expect(Object.keys(BIDDER_COL)).toHaveLength(BIDDER_NUMBERS_HEADERS.length);
  });

  it("ITEM_COL covers columns A-M once each", () => {
    expect(Object.values(ITEM_COL).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("TICKETS_COL's payment columns are the ones the attendee page edits on the 'tickets' tab", () => {
    const letters = paymentColumnsForSheet("tickets");
    expect(getColumnLetter(TICKETS_COL.paymentMethod)).toBe(letters.paymentMethod);
    expect(getColumnLetter(TICKETS_COL.paymentStatus)).toBe(letters.paymentStatus);
    expect(getColumnLetter(TICKETS_COL.totalPaid)).toBe(letters.totalPaid);
  });
});
