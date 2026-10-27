import { describe, it, expect } from "vitest";
import { computeArchiveAttendance } from "./archiveStats";
import { Bidder } from "@/types";

const bidder = (id: string, over: Partial<Bidder> = {}): Bidder => ({
  id, firstName: "F" + id, lastName: "L" + id, email: "", checkedIn: false, isProxy: false,
  checkedOut: false, paid: false, rowIndex: 2, ...over,
});

describe("computeArchiveAttendance", () => {
  it("counts registered, checked-in and proxy bidders, and lists everyone else as a no-show in bidder-number order", () => {
    const result = computeArchiveAttendance([
      bidder("12"), bidder("3", { checkedIn: true }), bidder("9", { isProxy: true }), bidder("5"),
    ]);

    expect(result.registered).toBe(4);
    expect(result.checkedIn).toBe(1);
    expect(result.proxies).toBe(1);
    expect(result.noShows.map((b) => b.id)).toEqual(["5", "12"]);
  });

  it("leaves proxy bidders out of the no-show percentage's denominator (2 of 3 expected in person = 67%)", () => {
    const result = computeArchiveAttendance([
      bidder("1", { checkedIn: true }), bidder("2"), bidder("3"), bidder("4", { isProxy: true }),
    ]);

    expect(result.noShowPercent).toBe(67);
  });

  it("is all zeros, not NaN, with no bidders", () => {
    expect(computeArchiveAttendance([])).toEqual({ registered: 0, checkedIn: 0, proxies: 0, noShows: [], noShowPercent: 0 });
  });
});
