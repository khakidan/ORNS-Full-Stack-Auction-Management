/**
 * The auction's state, held as text in the Bid Management spreadsheet's
 * `Auction-Status!A2` (server/utils/auctionState.ts has the same parser -
 * keep them in step). It only moves forward: Prep -> Live -> Closed.
 */
export type AuctionState = "prep" | "live" | "closed";

/** Old sheets hold a checkbox boolean: TRUE (open) is Prep, FALSE is Closed. Blank or unknown is Prep. */
export function parseAuctionState(cell: unknown): AuctionState {
  if (cell === false) return "closed";
  const text = String(cell ?? "").trim().toLowerCase();
  if (text === "false" || text === "closed") return "closed";
  if (text === "live") return "live";
  return "prep";
}
