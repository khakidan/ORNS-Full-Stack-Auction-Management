/**
 * Tests the REAL source of
 * scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GoogleAIStudio.gs's `recordPayment` -
 * the function `apiRecordPayment` (called by server/services/auctionService.ts
 * for every checkout) delegates to. Loaded via helpers/loadGasClass
 * alongside its real GlobalVariables base class, not a Node reimplementation.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect, vi } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";
import { FakeSpreadsheet } from "./helpers/fakeSheet";

const { GoogleAIStudio } = loadGasClasses(
  [
    "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GlobalVariables.gs",
    "scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/Class_GoogleAIStudio.gs",
  ],
  ["GlobalVariables", "GoogleAIStudio"]
);

// Column layout of a Bidder-Numbers row (0-indexed), matching
// Class_BidderManager.gs's real header write (copyBiddersToBidderSheet):
// A id, B firstName, C lastName, D email, E checkedIn, F proxy,
// G checkedOut, H paid, I methodLabel, J invoiceUrl, K invoicedAmount, L timestamp
const HEADER = ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid", "Method", "InvoiceURL", "Amount", "Timestamp"];

function makeBidderRow(overrides: Partial<Record<string, any>> = {}) {
  const row = ["101", "Jane", "Doe", "jane@example.com", true, false, false, false, "", "", 0, ""];
  Object.assign(row, overrides);
  return row;
}

function newStudio(sheetRows: any[][], paypalService: any = {}) {
  const ss = new FakeSpreadsheet();
  const sheet = ss.addSheet("Bidder-Numbers", [HEADER, ...sheetRows]);
  const studio = new GoogleAIStudio({
    activeSpreadSheet: ss,
    config: {},
    paypalService,
  });
  return { studio, sheet, ss };
}

describe("GoogleAIStudio.recordPayment - offline payment methods (cash/check)", () => {
  it("marks the bidder paid/checked-out and records the offline payment on PayPal", () => {
    const rows = [makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-AAAA-BBBB-CCCC-DDDD", 10: 104.12, 11: "2026-01-01T00:00:00.000Z" })];
    const recordOfflinePayment = vi.fn().mockReturnValue(true);
    const { studio, sheet } = newStudio(rows, {
      extractInvoiceIdFromUrl: (url: string) => url.split("#")[1],
      recordOfflinePayment,
    });

    const result = studio.recordPayment("101", "cash");

    expect(result).toEqual({ success: true, deferred: false, paypalRecorded: true });
    expect(sheet.data[1][6]).toBe(true); // G: Checked Out
    expect(sheet.data[1][7]).toBe(true); // H: Paid
    expect(sheet.data[1][8]).toBe("Cash"); // I: Method label
    expect(sheet.data[1][11]).toBe(""); // L: timestamp cleared
    expect(recordOfflinePayment).toHaveBeenCalledWith("INV2-AAAA-BBBB-CCCC-DDDD", "Cash", 104.12);
  });

  it("uses the 'Check' label for check payments", () => {
    const rows = [makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 50 })];
    const recordOfflinePayment = vi.fn().mockReturnValue(true);
    const { studio, sheet } = newStudio(rows, {
      extractInvoiceIdFromUrl: () => "INV2-X",
      recordOfflinePayment,
    });

    studio.recordPayment("101", "check");

    expect(sheet.data[1][8]).toBe("Check");
    expect(recordOfflinePayment).toHaveBeenCalledWith("INV2-X", "Check", 50);
  });

  it("still marks the bidder paid in the sheet even if the PayPal-side recording throws", () => {
    const rows = [makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 50 })];
    const { studio, sheet } = newStudio(rows, {
      extractInvoiceIdFromUrl: () => "INV2-X",
      recordOfflinePayment: vi.fn().mockImplementation(() => {
        throw new Error("PayPal API down");
      }),
    });

    const result = studio.recordPayment("101", "cash");

    expect(result).toEqual({ success: true, deferred: false, paypalRecorded: false });
    expect(sheet.data[1][6]).toBe(true); // still marked checked out (and paid) in the sheet
  });

  it("skips the PayPal call entirely (and still reports paypalRecorded: true) when there's no invoice ID", () => {
    // Pins current behavior: `if (invoiceId) paypal.recordOfflinePayment(...)` is
    // simply skipped when there's no invoice URL - nothing throws, so the
    // unconditional `paypalRecorded: true` at the end of the try block still
    // returns, even though nothing was actually recorded on PayPal.
    const rows = [makeBidderRow()]; // no invoice URL
    const recordOfflinePayment = vi.fn();
    const { studio, sheet } = newStudio(rows, {
      extractInvoiceIdFromUrl: () => null,
      recordOfflinePayment,
    });

    const result = studio.recordPayment("101", "cash");

    expect(result).toEqual({ success: true, deferred: false, paypalRecorded: true });
    expect(recordOfflinePayment).not.toHaveBeenCalled();
    expect(sheet.data[1][6]).toBe(true);
  });
});

describe("GoogleAIStudio.recordPayment - credit_card (live PayPal gate)", () => {
  it("marks paid immediately when PayPal already shows the invoice as PAID", () => {
    const rows = [makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 })];
    const { studio, sheet } = newStudio(rows, {
      extractInvoiceIdFromUrl: () => "INV2-X",
      getInvoiceStatus: vi.fn().mockReturnValue("PAID"),
    });

    const result = studio.recordPayment("101", "credit_card");

    expect(result).toEqual({ success: true, deferred: false, status: "PAID" });
    expect(sheet.data[1][6]).toBe(true); // G: Checked Out
    expect(sheet.data[1][7]).toBe(true); // H: Paid
    expect(sheet.data[1][8]).toBe("Credit Card / PayPal");
    expect(sheet.data[1][11]).toBe(""); // timestamp cleared
  });

  it("defers to the background sweeper when PayPal doesn't show the invoice as paid yet", () => {
    const rows = [makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 })];
    const { studio, sheet } = newStudio(rows, {
      extractInvoiceIdFromUrl: () => "INV2-X",
      getInvoiceStatus: vi.fn().mockReturnValue("SENT"),
    });

    const result = studio.recordPayment("101", "credit_card");

    expect(result).toEqual({ success: true, deferred: true, status: "SENT" });
    expect(sheet.data[1][6]).toBe(false); // G: Checked Out stays false
    expect(sheet.data[1][7]).toBe(false); // H: Paid stays false
    expect(sheet.data[1][8]).toBe("PayPal Verification Pending");
    expect(typeof sheet.data[1][11]).toBe("string");
    expect(sheet.data[1][11]).not.toBe(""); // timestamp stamped
  });

  it("defers without calling getInvoiceStatus when there's no invoice ID to check", () => {
    const rows = [makeBidderRow()]; // no invoice URL
    const getInvoiceStatus = vi.fn();
    const { studio, sheet } = newStudio(rows, {
      extractInvoiceIdFromUrl: () => null,
      getInvoiceStatus,
    });

    const result = studio.recordPayment("101", "credit_card");

    expect(getInvoiceStatus).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, deferred: true, status: "UNPAID" });
    expect(sheet.data[1][8]).toBe("PayPal Verification Pending");
  });

  it("wraps a getInvoiceStatus failure into a 'Credit Card validation processing error'", () => {
    const rows = [makeBidderRow({ 9: "https://www.paypal.com/invoice/p/#INV2-X", 10: 104.12 })];
    const { studio } = newStudio(rows, {
      extractInvoiceIdFromUrl: () => "INV2-X",
      getInvoiceStatus: vi.fn().mockImplementation(() => {
        throw new Error("PayPal Live Lookup Failed (404): not found");
      }),
    });

    expect(() => studio.recordPayment("101", "credit_card")).toThrow(/Credit Card validation processing error/);
  });
});

describe("GoogleAIStudio.recordPayment - error paths", () => {
  it("returns a not-found error when the bidder ID isn't in the sheet", () => {
    const { studio } = newStudio([makeBidderRow({ 0: "101" })]);
    expect(studio.recordPayment("999", "cash")).toEqual({ success: false, error: "Bidder ID not found" });
  });

  it("throws for an unrecognized payment method", () => {
    // recordPayment resolves the invoice ID before checking paymentMethod at
    // all, so even this test needs a minimal fake paypalService.
    const { studio } = newStudio([makeBidderRow()], { extractInvoiceIdFromUrl: () => null });
    expect(() => studio.recordPayment("101", "PAYPAL")).toThrow(/Unknown checkout payment method specified: PAYPAL/);
  });
});
