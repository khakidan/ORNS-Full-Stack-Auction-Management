/**
 * The Fluent Forms Webhook feed's body -> a TicketPurchase (ROADMAP W3).
 */
import { describe, it, expect } from "vitest";
import { purchaseFromWebhook, WEBHOOK_FIELDS } from "../services/fluentFormsWebhookPayload";
import { ticketRowFromPurchase } from "../services/ticketPurchaseRow";

/** Shaped like test entry 1480: 2 tickets, one guest with their own number, cash/check. Unused guest slots arrive blank. */
const body = (overrides: Record<string, unknown> = {}) => ({
  entry_id: "1480",
  first_name: "Pat", last_name: "Lee", email: "pat@example.com", phone: "(123) 456-7890",
  tickets: "2",
  guest_1_first_name: "Sam", guest_1_last_name: "Lee", guest_1_email: "sam@example.com", guest_1_own_number: "yes",
  guest_2_first_name: "", guest_2_last_name: "", guest_2_email: "", guest_2_own_number: "",
  guest_3_first_name: "", guest_3_last_name: "", guest_3_email: "", guest_3_own_number: "",
  payment_method: "test", payment_status: "pending", payment_total: "$70.00", transaction_id: "",
  ...overrides,
});

describe("purchaseFromWebhook", () => {
  it("documents exactly the fields it reads", () => {
    expect(Object.keys(body()).sort()).toEqual([...WEBHOOK_FIELDS].sort());
  });

  it("turns the feed's text into a purchase W2 writes as the Sheets feed would", () => {
    const purchase = purchaseFromWebhook(body());
    if ("error" in purchase) throw new Error(purchase.error);
    expect(purchase).toMatchObject({ entryId: "1480", firstName: "Pat", tickets: 2, paymentMethod: "test", paymentStatus: "pending", total: 70 });
    expect(purchase.guests[0]).toEqual({ firstName: "Sam", lastName: "Lee", email: "sam@example.com", ownBidderNumber: true });

    const built = ticketRowFromPurchase(purchase);
    if ("problems" in built) throw new Error(built.problems.join(" "));
    expect(built.row.slice(7, 19)).toEqual(["Sam", "Lee", "sam@example.com", "yes", "", "", "", "", "", "", "", ""]);
    expect(built.row.slice(19)).toEqual(["Offline", "Pending", "$70", "1480"]);
  });

  it("reads a purchase with no guests, where the guest questions were hidden", () => {
    const purchase = purchaseFromWebhook(body({ guest_1_first_name: "", guest_1_last_name: "", guest_1_email: "", guest_1_own_number: "" }));
    if ("error" in purchase) throw new Error(purchase.error);
    const built = ticketRowFromPurchase(purchase);
    expect("row" in built && built.row[5]).toBe("");
  });

  it.each([
    ["$1,140.00", 1140],
    ["140", 140],
    ["70.5", 70.5],
    ["free", NaN],
    ["", NaN],
  ])("reads the total %s as %s", (total, dollars) => {
    const purchase = purchaseFromWebhook(body({ payment_total: total }));
    expect("error" in purchase ? null : purchase.total).toEqual(dollars);
  });

  it.each([["2", 2], [" 3 ", 3], ["2 tickets", NaN], ["1.5", NaN], ["", NaN]])("reads tickets %j as %s - anything else goes to review", (tickets, count) => {
    const purchase = purchaseFromWebhook(body({ tickets }));
    expect("error" in purchase ? null : purchase.tickets).toEqual(count);
  });

  it.each([["yes", true], ["Yes", true], ["no", false], ["", false], ["Should This Guest Have Their Own Bidder Number?", false]])(
    "reads the own-number answer %j as %s - a label sent by mistake isn't a yes",
    (answer, own) => {
      const purchase = purchaseFromWebhook(body({ guest_1_own_number: answer }));
      expect("error" in purchase ? null : purchase.guests[0].ownBidderNumber).toBe(own);
    }
  );

  it("accepts the entry ID as a number too", () => {
    const purchase = purchaseFromWebhook(body({ entry_id: 1480 }));
    expect("error" in purchase ? null : purchase.entryId).toBe("1480");
  });

  it.each([
    ["no body", undefined, "JSON object"],
    ["a list", [body()], "JSON object"],
    ["a form-encoded body the JSON parser left empty", {}, "entry_id is missing"],
    ["no entry ID", body({ entry_id: " " }), "entry_id is missing"],
  ])("refuses %s - the feed's set-up, not the purchase", (_label, input, message) => {
    const result = purchaseFromWebhook(input);
    expect("error" in result && result.error).toContain(message);
  });
});
