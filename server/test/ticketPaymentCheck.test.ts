/**
 * checkTicketPayment: a website purchase's payment status from the payment
 * itself - Fluent Forms' record and PayPal - never the form (ROADMAP W4).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { checkTicketPayment, paypalForTickets } from "../services/ticketPaymentCheck";
import { sheetCache } from "../utils/sheetCache";
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
    ["Fluent Forms says processing but has no PayPal transaction ID yet", { transactions: [txn({ status: "processing", chargeId: "" })] }, "Fluent Forms says processing"],
    ["there's no payment yet", { transactions: [] }, "no payment yet"],
  ])("leaves the row Pending when %s", async (_label, payment, reason) => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps(payment) });
    expect(result).toMatchObject({ outcome: "unchanged", status: "Pending", reason: expect.stringContaining(reason) });
    expect(updates).toEqual([]);
  });

  it("waits while PayPal still has the payment pending (an eCheck)", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({}, { status: "PENDING", amount: 70, currency: "USD", pendingReason: "ECHECK" }) });
    expect(result).toMatchObject({ outcome: "unchanged", reason: expect.stringContaining("still pending") });
    expect(updates).toEqual([]);
    expect((await review("1500").get()).exists).toBe(false);
  });

  it("puts a payment PayPal is holding for review on the review list - Fluent Forms calls it paid, but it isn't yet", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({}, { status: "PENDING", amount: 70, currency: "USD", pendingReason: "PENDING_REVIEW" }) });
    expect(result).toMatchObject({ outcome: "needs-review", problems: [expect.stringContaining("holding payment")] });
    expect(updates).toEqual([]);
    expect((await review("1500").get()).data()?.problems).toEqual([expect.stringContaining("holding payment")]);
  });

  it("asks PayPal about a payment Fluent Forms still calls processing: held for review goes on the list straight away", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const d = deps({ transactions: [txn({ status: "processing" })] }, { status: "PENDING", amount: 70, currency: "USD", pendingReason: "PENDING_REVIEW" });

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...d });

    expect(d.paypal.getPayment).toHaveBeenCalledWith(CHARGE, expect.any(Date));
    expect(result).toMatchObject({ outcome: "needs-review", problems: [expect.stringContaining("holding payment")] });
    expect(updates).toEqual([]);
  });

  it("marks a processing payment Paid once PayPal says it's completed - even if Fluent Forms never hears", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({ transactions: [txn({ status: "processing" })] }) });
    expect(result).toMatchObject({ outcome: "set", to: "Paid" });
    expect(updates).toHaveLength(1);
  });

  it("marks it Paid and clears the review once PayPal releases it", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({}, { status: "PENDING", amount: 70, currency: "USD", pendingReason: "PENDING_REVIEW" }) });

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({}, { status: "COMPLETED", amount: 70, currency: "USD" }) });

    expect(result).toMatchObject({ outcome: "set", to: "Paid" });
    expect(updates).toHaveLength(1);
    expect((await review("1500").get()).exists).toBe(false);
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

// ROADMAP T15: decisions Stryker showed no test checked.
describe("checkTicketPayment - what the mutation run found untested", () => {
  it("asks live PayPal when Settings says live, and the sandbox otherwise - live purchases only exist in live", async () => {
    const hosts: string[] = [];
    const record = ({ request }: { request: Request }) => {
      hosts.push(new URL(request.url).host);
      return request.url.includes("/oauth2/token")
        ? HttpResponse.json({ access_token: "t" })
        : HttpResponse.json({ status: "COMPLETED", amount: { value: "70.00", currency_code: "USD" } });
    };
    server.use(http.all("https://api-m.paypal.com/*", record), http.all("https://api-m.sandbox.paypal.com/*", record));

    for (const [setting, host] of [[false, "api-m.paypal.com"], [true, "api-m.sandbox.paypal.com"], [undefined, "api-m.sandbox.paypal.com"]] as const) {
      const { _resetConfigCacheForTesting } = await import("../services/configService");
      await getAdminFirestore().collection("settings").doc("global").set({ auctionTicketsSpreadsheetId: "tk", ...(setting === undefined ? {} : { paypalIsSandbox: setting }) });
      _resetConfigCacheForTesting();
      hosts.length = 0;

      await (await paypalForTickets()).getPayment(CHARGE, new Date());

      expect([...new Set(hosts)]).toEqual([host]);
    }
  });

  it("refuses to run without the Tickets spreadsheet set, rather than guessing one", async () => {
    await getAdminFirestore().collection("settings").doc("global").set({});
    const { _resetConfigCacheForTesting } = await import("../services/configService");
    _resetConfigCacheForTesting();
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);

    await expect(checkTicketPayment(sheets, "1500", { mode: "write", ...deps() })).rejects.toThrow("The Auction Tickets Spreadsheet ID isn't set in Settings.");
    expect(sheets.spreadsheets.values.get).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("tells open screens about the write and logs it with the payment in the summary", async () => {
    sheetCache.set("tk:someone:'tickets'!A:W", { data: "stale", timestamp: Date.now() });
    sheetCache.set("other:someone:A1", { data: "keep", timestamp: Date.now() });
    const { sheets } = fakeSheets([ticketRow("1500")]);

    await checkTicketPayment(sheets, "1500", { mode: "write", ...deps() });

    expect(sheetCache.has("tk:someone:'tickets'!A:W")).toBe(false);
    expect(sheetCache.has("other:someone:A1")).toBe(true);
    expect(vi.mocked(logSystemAction)).toHaveBeenCalledWith(sheets, FLUENT_FORMS, {
      area: "Tickets",
      action: "Confirm ticket payment",
      target: "Pat Lee",
      summary: `Marked Pat Lee's ticket purchase Paid: PayPal confirmed payment ${CHARGE} for $70 (Fluent Forms entry 1500)`,
      before: ["Pending"],
      after: ["Paid"],
      location: "Auction Tickets 'tickets'!U2",
      notUndoableReason: expect.stringContaining("it was read from PayPal"),
    });
    // RAW, so nothing in the row can be read as a formula.
    expect(sheets.spreadsheets.values.update).toHaveBeenCalledWith(expect.objectContaining({ valueInputOption: "RAW" }));
  });

  it("treats a refund Fluent Forms lists only under refunds (the payment itself still says paid) as a refund", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500", "Paid")]);

    const result = await checkTicketPayment(sheets, "1500", {
      mode: "write",
      ...deps({ transactions: [txn()], refunds: [txn({ status: "refunded" })] }, { status: "REFUNDED", amount: 70, currency: "USD" }),
    });

    expect(result).toMatchObject({ outcome: "set", from: "Paid", to: "Refunded" });
    expect(updates).toEqual([{ range: "'tickets'!U2", values: [["Refunded"]] }]);
  });

  it("names a buyer with no last name without a trailing space", async () => {
    const row = ticketRow("1500");
    row[1] = "";
    const { sheets } = fakeSheets([row]);
    await checkTicketPayment(sheets, "1500", { mode: "write", ...deps() });
    expect(vi.mocked(logSystemAction)).toHaveBeenCalledWith(sheets, FLUENT_FORMS, expect.objectContaining({ target: "Pat" }));
  });

  it("logs a confirmed refund as a refund, not a payment", async () => {
    const { sheets } = fakeSheets([ticketRow("1500", "Paid")]);

    await checkTicketPayment(sheets, "1500", {
      mode: "write",
      ...deps({ transactions: [txn({ status: "refunded" })] }, { status: "REFUNDED", amount: 70, currency: "USD" }),
    });

    expect(vi.mocked(logSystemAction)).toHaveBeenCalledWith(sheets, FLUENT_FORMS, expect.objectContaining({
      action: "Record ticket refund",
      summary: `Marked Pat Lee's ticket purchase Refunded: PayPal reports payment ${CHARGE} refunded (Fluent Forms entry 1500)`,
      before: ["Paid"],
      after: ["Refunded"],
      location: "Auction Tickets 'tickets'!U2",
    }));
  });

  it("in compare mode, a refund PayPal confirms is only reported - nothing goes on the review list", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500", "Paid")]);

    const result = await checkTicketPayment(sheets, "1500", {
      mode: "compare",
      ...deps({ transactions: [txn({ status: "refunded" })] }, { status: "REFUNDED", amount: 70, currency: "USD" }),
    });

    expect(result).toEqual({ outcome: "would-set", entryId: "1500", from: "Paid", to: "Refunded", transactionId: CHARGE });
    expect((await review("1500").get()).exists).toBe(false);
    expect(updates).toEqual([]);
  });

  it("counts only PayPal's transactions: a paid one by another method doesn't make the PayPal purchase paid", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const d = deps({ transactions: [txn({ paymentMethod: "offline", status: "paid" })] });

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...d });

    expect(result).toEqual({ outcome: "unchanged", entryId: "1500", status: "Pending", reason: "Fluent Forms says no payment yet" });
    expect(d.paypal.getPayment).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("doesn't ask PayPal about a transaction Fluent Forms still calls pending, even one with an ID", async () => {
    const { sheets, updates } = fakeSheets([ticketRow("1500")]);
    const d = deps({ transactions: [txn({ status: "pending" }), txn({ status: "failed" })] });

    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...d });

    expect(result).toEqual({ outcome: "unchanged", entryId: "1500", status: "Pending", reason: "Fluent Forms says pending, failed" });
    expect(d.paypal.getPayment).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("only treats PENDING_REVIEW as a hold while the payment is still PENDING", async () => {
    const { sheets } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({}, { status: "COMPLETED", amount: 70, currency: "USD", pendingReason: "PENDING_REVIEW" }) });
    expect(result).toMatchObject({ outcome: "set", to: "Paid" });
  });

  it.each([
    [70.004, "set"],
    [70.01, "needs-review"],
    [69.99, "needs-review"],
  ])("accepts PayPal's amount only within half a cent of Fluent Forms' ($%s)", async (amount, outcome) => {
    const { sheets } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({}, { status: "COMPLETED", amount, currency: "USD" }) });
    expect(result.outcome).toBe(outcome);
  });

  it.each([
    ["PayPal says nothing about the payment", deps({ transactions: [txn({ status: "refunded" })] }, null), `PayPal says nothing for ${CHARGE}`],
    ["Fluent Forms' refund has no transaction ID", deps({ transactions: [txn({ status: "refunded", chargeId: "" })] }), "PayPal says nothing for this entry (no transaction ID)"],
  ])("puts a refund on the review list when %s", async (_label, d, problem) => {
    const { sheets, updates } = fakeSheets([ticketRow("1500", "Paid")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...d });
    expect(result).toMatchObject({ outcome: "needs-review", problems: [expect.stringContaining(problem)] });
    expect(updates).toEqual([]);
  });

  it("still checks a PayPal row whose cells have spaces around them", async () => {
    const { sheets } = fakeSheets([ticketRow("1500", " Pending ", " PayPal ")]);
    expect(await checkTicketPayment(sheets, "1500", { mode: "write", ...deps() })).toMatchObject({ outcome: "set", from: "Pending", to: "Paid" });
  });

  it("assumes USD when Fluent Forms leaves the currency blank, in the problem it reports", async () => {
    const { sheets } = fakeSheets([ticketRow("1500")]);
    const result = await checkTicketPayment(sheets, "1500", { mode: "write", ...deps({ transactions: [txn({ currency: "" })] }, { status: "COMPLETED", amount: 35, currency: "USD" }) });
    expect(result).toMatchObject({ outcome: "needs-review", problems: ["PayPal's payment is $35 USD, but Fluent Forms recorded $70 USD."] });
  });
});
