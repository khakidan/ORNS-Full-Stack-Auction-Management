/**
 * The auction's state, kept as text in the Bid Management spreadsheet's
 * `Auction-Status!A2`. Only ever moves forward: Prep -> Live -> Closed.
 * Going back means editing the cell by hand.
 */
export type AuctionState = "prep" | "live" | "closed";

export const AUCTION_STATE_CELL = {
  prep: "Prep",
  live: "Live",
  closed: "Closed",
} as const satisfies Record<AuctionState, string>;

/**
 * Reads the cell. Sheets from before the three states hold a checkbox
 * boolean: TRUE (open) is Prep and FALSE (closed) is Closed. Anything
 * unrecognized or blank is Prep, the same as an auction that was never
 * closed.
 */
export function parseAuctionState(cell: unknown): AuctionState {
  if (cell === false) return "closed";
  const text = String(cell ?? "").trim().toLowerCase();
  if (text === "false" || text === "closed") return "closed";
  if (text === "live") return "live";
  return "prep";
}
