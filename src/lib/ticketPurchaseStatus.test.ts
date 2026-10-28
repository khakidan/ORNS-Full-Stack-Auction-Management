import { describe, it, expect } from "vitest";
import { pendingTooLong, ticketStatusProblems } from "./ticketPurchaseStatus";
import { Attendee, TicketPurchaseStatus } from "@/types";

const NOW = new Date("2027-02-10T12:00:00");

const status = (overrides: Partial<TicketPurchaseStatus> = {}): TicketPurchaseStatus => ({
  configured: true,
  mode: "write",
  lastWebhook: { at: "2027-02-10T09:00:00", entryId: "1490", outcome: "added" },
  poll: { lastSuccessAt: "2027-02-10T06:00:00", lastRunAt: "2027-02-10T06:00:00", lastRunErrors: [], seasonStartEntryId: 1482 },
  missed: [],
  submittedAt: {},
  review: [],
  ...overrides,
});

const attendee = (id: string, overrides: Partial<Attendee> = {}): Attendee => ({
  id, sheet: "tickets", rowIndex: 2, firstName: "Pat", lastName: id, email: "", phone: "", ticketsPurchased: "2", hasGuests: "",
  guestsInfo: [], paymentMethod: "Offline", paymentStatus: "Pending", totalPaid: "$70", formEntryId: id, ...overrides,
});

describe("ticketStatusProblems", () => {
  it("is quiet when all is well", () => {
    expect(ticketStatusProblems(status(), NOW)).toEqual([]);
  });

  it("warns once the check hasn't succeeded for over 12 hours - two missed runs - not before", () => {
    expect(ticketStatusProblems(status({ poll: { ...status().poll!, lastSuccessAt: "2027-02-10T00:01:00" } }), NOW)).toEqual([]);
    expect(ticketStatusProblems(status({ poll: { ...status().poll!, lastSuccessAt: "2027-02-09T23:59:00" } }), NOW)).toEqual([expect.stringContaining("over 12 hours")]);
  });

  it("warns when the check has never succeeded", () => {
    expect(ticketStatusProblems(status({ poll: null }), NOW)).toEqual([expect.stringContaining("hasn't succeeded yet")]);
  });

  it("warns about a check that stopped, a failed webhook, and the review list", () => {
    const problems = ticketStatusProblems(status({
      poll: { ...status().poll!, lastRunErrors: ["WordPress said no"] },
      lastWebhook: { at: "2027-02-10T09:00:00", entryId: "1490", outcome: "error", error: "Sheets said no" },
      review: [{ entryId: "1491", name: "Pat Lee", problems: ["x"], firstSeenAt: "", lastSeenAt: "" }],
    }), NOW);
    expect(problems).toEqual([expect.stringContaining("stopped"), expect.stringContaining("failed"), "1 purchase(s) need review."]);
  });

  it("says nothing while the Fluent Forms API isn't set up - the card says that itself", () => {
    expect(ticketStatusProblems(status({ configured: false, poll: null }), NOW)).toEqual([]);
  });
});

describe("pendingTooLong", () => {
  it("lists website purchases still Pending over 7 days after they were bought, oldest first", () => {
    const submittedAt = { "1": "2027-02-01 10:00:00", "2": "2027-01-20 10:00:00", "3": "2027-02-05 10:00:00", "4": "2027-01-01 10:00:00" };
    const rows = pendingTooLong([attendee("1"), attendee("2"), attendee("3"), attendee("4", { paymentStatus: "Paid" })], submittedAt, NOW);
    expect(rows.map((r) => r.attendee.id)).toEqual(["2", "1"]);
  });

  it("leaves out rows the poll has no date for (added in the app, or last season)", () => {
    expect(pendingTooLong([attendee("1"), attendee("5", { formEntryId: "" })], { "5": "2027-01-01 10:00:00" }, NOW)).toEqual([]);
  });
});
