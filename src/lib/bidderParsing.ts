import { Bidder } from "@/types";

/** Parses raw Bidder-Numbers sheet rows (header row already excluded) into Bidder objects. */
export function parseBidderRows(rows: string[][]): Bidder[] {
  return rows
    .map((row, idx) => ({
      id: row[0]?.toString() || "",
      firstName: row[1]?.toString() || "",
      lastName: row[2]?.toString() || "",
      email: row[3]?.toString() || "",
      checkedIn: row[4] === "TRUE" || row[4] === "true",
      isProxy: row[5] === "TRUE" || row[5] === "true",
      checkedOut: row[6] === "TRUE" || row[6] === "true",
      paid: row[7] === "TRUE" || row[7] === "true",
      paymentMethod: row[8]?.toString() || "",
      checkoutTimestamp: row[11]?.toString() || "",
      rowIndex: idx + 2,
    }))
    .filter(b => b.id);
}
