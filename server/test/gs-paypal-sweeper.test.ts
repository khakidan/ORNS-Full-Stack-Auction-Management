/**
 * Tests the REAL source of scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/PayPalSweeper.gs's
 * `checkPendingPayPalInvoices` - the time-driven trigger (confirmed live,
 * every 5 minutes) that reconciles "PayPal Verification Pending" rows.
 * Loaded via helpers/loadGasClass, not a Node reimplementation.
 *
 * IMPORTANT: this only tests this repo's reference copy. Fixes here don't
 * take effect in the live spreadsheet until manually pasted into the Apps
 * Script editor - see CHANGELOG.md.
 */
import { describe, it, expect, vi } from "vitest";
import { loadGasClasses } from "./helpers/loadGasClass";
import { FakeSpreadsheet } from "./helpers/fakeSheet";

const { checkPendingPayPalInvoices } = loadGasClasses(
  ["scripts/GoogleAppsScriptsCode/BidManagementSpreadsheet/PayPalSweeper.gs"],
  ["checkPendingPayPalInvoices"]
);

// Column layout of a Bidder-Numbers row (0-indexed), matching
// Class_BidderManager.gs's real header write (copyBiddersToBidderSheet):
// A id, B firstName, C lastName, D email, E checkedIn, F proxy,
// G checkedOut, H paid, I methodLabel, J invoiceUrl, K invoicedAmount, L timestamp
const HEADER = ["ID", "First", "Last", "Email", "CheckedIn", "Proxy", "CheckedOut", "Paid", "Method", "InvoiceURL", "Amount", "Timestamp"];

function pendingRow(overrides: Record<number, any> = {}) {
  const row = ["101", "Jane", "Doe", "jane@example.com", true, false, false, false, "PayPal Verification Pending", "https://www.paypal.com/invoice/p/#INV2-X", 104.12, ""];
  Object.assign(row, overrides);
  return row;
}

const NOW = new Date("2026-01-01T12:00:00.000Z").getTime();

function run(rows: any[][], paypalService: any, now = NOW) {
  const ss = new FakeSpreadsheet();
  const sheet = ss.addSheet("Bidder-Numbers", [HEADER, ...rows]);
  checkPendingPayPalInvoices({ activeSpreadSheet: ss, paypalService, now });
  return { ss, sheet };
}

describe("checkPendingPayPalInvoices - reconciliation", () => {
  it("marks a row paid when PayPal reports PAID", () => {
    const { sheet } = run([pendingRow()], {
      extractInvoiceIdFromUrl: () => "INV2-X",
      getInvoiceStatus: vi.fn().mockReturnValue("PAID"),
    });

    expect(sheet.data[1][6]).toBe(true); // G: Checked Out
    expect(sheet.data[1][7]).toBe(true); // H: Paid
    expect(sheet.data[1][8]).toBe("Credit Card / PayPal");
    expect(sheet.data[1][11]).toBe(""); // L: timestamp cleared
  });

  it("also accepts MARKED_AS_PAID as a successful reconciliation", () => {
    const { sheet } = run([pendingRow()], {
      extractInvoiceIdFromUrl: () => "INV2-X",
      getInvoiceStatus: vi.fn().mockReturnValue("MARKED_AS_PAID"),
    });

    expect(sheet.data[1][6]).toBe(true);
    expect(sheet.data[1][8]).toBe("Credit Card / PayPal");
  });

  it("seeds a timestamp on a still-unpaid row that doesn't have one yet, without escalating", () => {
    const { sheet } = run([pendingRow({ 11: "" })], {
      extractInvoiceIdFromUrl: () => "INV2-X",
      getInvoiceStatus: vi.fn().mockReturnValue("SENT"),
    });

    expect(sheet.data[1][8]).toBe("PayPal Verification Pending"); // unchanged - not escalated
    expect(typeof sheet.data[1][11]).toBe("string");
    expect(sheet.data[1][11]).not.toBe("");
  });

  it("leaves a still-unpaid row with a recent timestamp completely alone", () => {
    const recentTimestamp = new Date(NOW - 2 * 60 * 1000).toISOString(); // 2 minutes ago
    const { sheet } = run([pendingRow({ 11: recentTimestamp })], {
      extractInvoiceIdFromUrl: () => "INV2-X",
      getInvoiceStatus: vi.fn().mockReturnValue("SENT"),
    });

    expect(sheet.data[1][8]).toBe("PayPal Verification Pending");
    expect(sheet.data[1][11]).toBe(recentTimestamp); // untouched
    expect(sheet.data[1][6]).toBe(false);
    expect(sheet.data[1][7]).toBe(false);
  });

  it("escalates to Follow-Up once the row has been pending past the 10-minute threshold", () => {
    const oldTimestamp = new Date(NOW - 11 * 60 * 1000).toISOString(); // 11 minutes ago
    const { ss, sheet } = run([pendingRow({ 11: oldTimestamp, 10: 104.12 })], {
      extractInvoiceIdFromUrl: () => "INV2-X",
      getInvoiceStatus: vi.fn().mockReturnValue("SENT"),
    });

    // Source row marked failed
    expect(sheet.data[1][6]).toBe(false); // G stays false
    expect(sheet.data[1][7]).toBe(false); // H stays false
    expect(sheet.data[1][8]).toBe("Failed Verification - Follow Up Required");
    expect(sheet.data[1][11]).toBe(""); // timestamp cleared

    // Follow-Up sheet created with a header row and the escalation logged
    const followUp = ss.getSheetByName("Follow-Up")!;
    expect(followUp).not.toBeNull();
    expect(followUp.data[0]).toEqual(["Timestamp", "Bidder Number", "Name", "Amount Flagged", "Invoice URL", "System Notes"]);
    expect(followUp.data[1][1]).toBe("101"); // Bidder Number
    expect(followUp.data[1][2]).toBe("Jane Doe"); // Name
    expect(followUp.data[1][3]).toBe(104.12); // Amount Flagged
    expect(String(followUp.data[1][5])).toContain("SENT");
  });

  it("appends to an existing Follow-Up sheet instead of recreating it", () => {
    const ss = new FakeSpreadsheet();
    ss.addSheet("Bidder-Numbers", [HEADER, pendingRow({ 11: new Date(NOW - 20 * 60 * 1000).toISOString() })]);
    const existingFollowUp = ss.addSheet("Follow-Up", [["Timestamp", "Bidder Number", "Name", "Amount Flagged", "Invoice URL", "System Notes"], ["2025-01-01", "999", "Old Row", 10, "url", "note"]]);

    checkPendingPayPalInvoices({
      activeSpreadSheet: ss,
      now: NOW,
      paypalService: { extractInvoiceIdFromUrl: () => "INV2-X", getInvoiceStatus: vi.fn().mockReturnValue("SENT") },
    });

    expect(existingFollowUp.data.length).toBe(3); // header + pre-existing row + new escalation
  });

  it("skips a row with no extractable invoice ID without touching the sheet", () => {
    const { sheet } = run([pendingRow({ 9: "" })], {
      extractInvoiceIdFromUrl: () => null,
      getInvoiceStatus: vi.fn(),
    });

    expect(sheet.data[1][6]).toBe(false);
    expect(sheet.data[1][8]).toBe("PayPal Verification Pending"); // unchanged
  });

  it("ignores rows whose method label isn't 'PayPal Verification Pending'", () => {
    const { sheet } = run(
      [pendingRow({ 8: "Cash" }), pendingRow({ 0: "102", 8: "" })],
      { extractInvoiceIdFromUrl: vi.fn(), getInvoiceStatus: vi.fn() }
    );

    // Neither row should have been touched by the sweep
    expect(sheet.data[1][8]).toBe("Cash");
    expect(sheet.data[2][8]).toBe("");
  });

  it("does nothing (and doesn't throw) when the Bidder-Numbers sheet is missing", () => {
    const ss = new FakeSpreadsheet();
    expect(() => checkPendingPayPalInvoices({ activeSpreadSheet: ss, now: NOW, paypalService: {} })).not.toThrow();
  });

  it("does nothing (and doesn't throw) when PayPalService construction itself fails", () => {
    // No paypalService override given, and this test file doesn't even load
    // Class_PayPalService.gs into the vm context, so `new PayPalService()`
    // throws a ReferenceError - the sweeper's own try/catch around that
    // construction should swallow it and return gracefully, not propagate.
    const ss = new FakeSpreadsheet();
    const sheet = ss.addSheet("Bidder-Numbers", [HEADER, pendingRow()]);
    expect(() => checkPendingPayPalInvoices({ activeSpreadSheet: ss, now: NOW })).not.toThrow();
    expect(sheet.data[1][8]).toBe("PayPal Verification Pending"); // untouched
  });
});
