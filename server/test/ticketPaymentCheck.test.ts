/**
 * checkTicketPayment: a website purchase's payment status from the payment
 * itself - Fluent Forms' record and PayPal - never the form (ROADMAP W4).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkTicketPayment } from "../services/ticketPaymentCheck";
import { FluentFormsEntryPayment, FluentFormsTransaction } from "../services/fluentFormsApi";
import { PayPalPayment } from "../services/paypalService";
import { FLUENT_FORMS } from "../services/ticketPurchaseService";
import { logSystemAction } from "../services/actionLog";
import { getAdminFirestore } from "../services/firebaseAdmin";

const CHARGE = "9AB12345CD678901E";

/** A tickets row (A-W): Pat Lee, PayPal, `status`, $70, entry `entryId`. */
function ticketRow(entryId: string, status = "Pending", method = "PayPal") {
  const row: string[] = Array(23).fill("");
  row[0] = "Pat"; row[1] = "Lee"; row[4] = "2";
  row[19] = method; row[20] = status; row[21] = "$70"; row[22] = entryId;
  return row;
}

function fakeSheets(rows: string[][]) {
  const tab = [Array(23).fill("header"), ...rows];
  const updates: { range: string; values: unknown[][] }[] = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: vi.fn(async ({ range }: { range: string }) => {
          if (range === "'tickets'!W:W") return { data: { values: tab.map((r) => [r[22]]) } };
          const n = Number(/^'tickets'!A(\d+):W\1$/.exec(range)?.[1]);
          if (!n) throw new Error(`unexpected range ${range}`);
          return { data: { values: [tab[n - 1]] } };
        }),
        update: vi.fn(async ({ range, requestBody }: any) => {
          updates.push({ range, values: requestBody.values });
          return { data: {} };
        }),
      },
    },
  };
  return { sheets: sheets as any, updates };
}

const txn = (overrides: Partial<FluentFormsTransaction> = {}): FluentFormsTransaction => ({
  submissionId: "1500", formId: "7", paymentMethod: "paypal", status: "paid", chargeId: CHARGE,
  total: 70, currency: "USD", createdAt: "2026-04-25 12:05:02", ...overrides,
});

function deps(payment: Partial<FluentFormsEntryPayment> = {}, atPayPal: PayPalPayment | null = { status: "COMPLETED", amount: 70, currency: "USD" }) {
  return {
    fluentForms: { getEntryPayment: vi.fn(async () => ({ transactions: [txn()], refunds: [], ...payment })) },
    paypal: { getPayment: vi.fn(async () => atPayPal) },
  };
}

const review = (id: string) => getAdminFirestore().collection("ticketPurchaseReview").doc(id);
const claim = (charge: string) => getAdminFirestore().collection("ticketPaymentCharges").doc(charge);

beforeEach(async () => {
  await getAdminFirestore().collection("settings").doc("global").set({ auctionTicketsSpreadsheetId: "tk" });
});

describe("checkTicketPayment", () => {
  it("marks a PayPal purchase Paid once PayPal confirms the payment Fluent Forms recorded", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1400"), ticketRow("1500")]);
    const d = deps();

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...d });

    expect(result).toEqual({ outcome: "set", entryId: "1500", from: "Pending", to: "Paid", transactionId: CHARGE });
    expect(updates).toEqual([{ range: "'tickets'!U3", values: [["Paid"]] }]);
    expect(d.paypal.getPayment).toHaveBeenCalledWith(CHARGE, new Date("2026-04-25 12:05:02"));
    expect(vi.mocked(logSystemAction)).toHaveBeenCalledWith(sheets, FLUENT_FORMS, expect.objectContaining({
      area: "Tickets", action: "Confirm ticket payment", target: "Pat Lee", before: ["Pending"], after: ["Paid"],
    }));
    expect((await claim(CHARGE).get()).data()?.entryId).toBe("1500");
  });

  it("in compare mode (shadow) says what it would set and writes nothing", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);

    const result = await checkTicketPayment(sheets, "1500", { mode: "compare", ...deps() });

    expect(result).toMatchObject({ outcome: "would-set", to: "Paid" });
    expect(updates).toEqual([]);
    expect(vi.mocked(logSystemAction)).not.toHaveBeenCalled();
    expect((await claim(CHARGE).get()).exists).toBe(false);
  });

  it("leaves cash/check to staff without asking Fluent Forms or PayPal", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500", "Pending", "Offline")]);
    const d = deps();

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...d });

    expect(result).toEqual({ outcome: "offline", entryId: "1500", status: "Pending" });
    expect(d.fluentForms.getEntryPayment).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("does nothing when there's no row for the entry yet", async () => {
    const { sheets } = fakeSheets([ticketRow("1400")]);
    expect(await checkTicketPayment(sheets, "1500", { mode: "write", ...deps() })).toEqual({ outcome: "no-row", entryId: "1500" });
  });

  it.each(["pending", "paid"])("never changes a Paid row (staff may have recorded it) when Fluent Forms says %s", async (said) => {
    const { sheets, updates } = fakeSheets([ticketRow("1500", "Paid")]);
    const d = deps({ transactions: [txn({ status: said })] });

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...d });

    expect(result).toEqual({ outcome: "unchanged", entryId: "1500", status: "Paid", reason: "already Paid" });
    expect(d.paypal.getPayment).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it.each([
    ["Fluent Forms says pending", { transactions: [txn({ status: "pending", chargeId: "" })] }, "Fluent Forms says pending"],
    ["there's no payment yet", { transactions: [] }, "no payment yet"],
  ])("leaves the row Pending when %s", async (_label, payment, reason) => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps(payment) });
    expect(result).toMatchObject({ outcome: "unchanged", status: "Pending", reason: expect.stringContaining(reason) });
    expect(updates).toEqual([]);
  });

  it("waits while PayPal still has the payment pending (an eCheck)", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({}, { status: "PENDING", amount: 70, currency: "USD" }) });
    expect(result).toMatchObject({ outcome: "unchanged", reason: expect.stringContaining("still pending") });
    expect(updates).toEqual([]);
  });

  it.each([
    ["Fluent Forms has no transaction ID", deps({ transactions: [txn({ chargeId: "" })] }), "no PayPal transaction ID"],
    ["PayPal has no such payment (a forged or edited ID)", deps({}, null), "PayPal has no payment"],
    ["PayPal's amount differs", deps({}, { status: "COMPLETED", amount: 35, currency: "USD" }), "PayPal's payment is $35 USD, but Fluent Forms recorded $70"],
    ["PayPal's currency differs", deps({}, { status: "COMPLETED", amount: 70, currency: "CAD" }), "$70 CAD"],
    ["PayPal says it was declined", deps({}, { status: "DECLINED", amount: 70, currency: "USD" }), "DECLINED, not completed"],
  ])("puts the purchase on the review list, not Paid, when %s", async (_label, d, problem) => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...d });

    expect(result).toMatchObject({ outcome: "needs-review", problems: [expect.stringContaining(problem)] });
    expect(updates).toEqual([]);
    expect((await review("1500").get()).data()).toMatchObject({ entryId: "1500", name: "Pat Lee", problems: [expect.stringContaining(problem)] });
  });

  it("won't let one PayPal payment mark two purchases paid", async () => {
    await claim(CHARGE).set({ entryId: "1400" });
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps() });

    expect(result).toMatchObject({ outcome: "needs-review", problems: [expect.stringContaining("already paid for Fluent Forms entry 1400")] });
    expect(updates).toEqual([]);
  });

  it("checks the same purchase again without complaint once it's been confirmed", async () => {
    await claim(CHARGE).set({ entryId: "1500" });
    const { sheets } = fakeSheets([ticketRow("1500")]);
    expect(await checkTicketPayment(sheets, "1500", { mode: "write", ...deps() })).toMatchObject({ outcome: "set" });
  });

  it("doesn't touch the review list in compare mode", async () => {
    const { sheets } = fakeSheets([ticketRow("1500")]);
    await checkTicketPayment(sheets, "1500", { mode: "compare", ...deps({}, null) });
    expect((await review("1500").get()).exists).toBe(false);
  });

  it("takes the purchase off the review list once its payment is confirmed", async () => {
    const { sheets } = fakeSheets([ticketRow("1500")]);
    await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({}, null) });

    await checkTicketPayment(sheets, "1500", { mode: "write", ...deps() });

    expect((await review("1500").get()).exists).toBe(false);
  });

  it("marks a refund PayPal confirms as Refunded - even on a Paid row - and flags it for staff", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500", "Paid")]);

    const result = await checkTicketPayment(sheets, "1500", {
      mode: "write",
      ...deps({ transactions: [txn({ status: "refunded" })], refunds: [txn({ status: "refunded" })] }, { status: "REFUNDED", amount: 70, currency: "USD" }),
    });

    expect(result).toMatchObject({ outcome: "set", from: "Paid", to: "Refunded" });
    expect(updates).toEqual([{ range: "'tickets'!U2", values: [["Refunded"]] }]);
    expect((await review("1500").get()).data()?.problems).toEqual([expect.stringContaining("Refunded in PayPal")]);
  });

  it("only flags a refund PayPal doesn't confirm (or a partial one) - the status stays", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500", "Paid")]);

    const result = await checkTicketPayment(sheets, "1500", {
      mode: "write",
      ...deps({ transactions: [txn({ status: "partially-refunded" })] }, { status: "PARTIALLY_REFUNDED", amount: 70, currency: "USD" }),
    });

    expect(result).toMatchObject({ outcome: "needs-review", problems: [expect.stringContaining("PayPal says PARTIALLY_REFUNDED")] });
    expect(updates).toEqual([]);
  });

  it("leaves a row already marked Refunded alone", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500", "Refunded")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({ transactions: [txn({ status: "refunded" })] }) });
    expect(result).toMatchObject({ outcome: "unchanged", reason: "already Refunded" });
    expect(updates).toEqual([]);
  });

  it("lets an error from Fluent Forms or PayPal through, so it's reported, not read as unpaid", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const d = deps();
    d.paypal.getPayment.mockRejectedValue(new Error("PayPal transaction search failed (403)"));

    await expect(checkTicketPayment(sheets, "1500", { mode: "write", ...d })).rejects.toThrow("403");
    expect(updates).toEqual([]);
  });
});
