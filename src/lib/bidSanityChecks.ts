import { parseDollar } from "@/lib/auctionItemPricing";
import { AuctionItem } from "@/types";
import { getCategoryBase } from "@/lib/categoryHelpers";

/** Live (1301), Raffle Tickets (1501) and Open Appeal (1601) - see `steppedBidding`. */
const UNSTEPPED_CATEGORY_BASES = new Set([1301, 1501, 1601]);

/**
 * Whether the item's bids go up in Minimum Raise steps from the Opening
 * Bid. Silent-auction sheets do; Live items are called by the auctioneer,
 * raffle tickets and Open Appeal tiers are bought (often several at once),
 * so a figure in those columns says nothing about a valid amount
 * (ROADMAP A12).
 */
function steppedBidding(item: AuctionItem): boolean {
  return !item.allowMultipleWinners && !UNSTEPPED_CATEGORY_BASES.has(getCategoryBase(item.category));
}

/** Above this many times the item's value, an amount is probably an extra digit. */
export const VALUE_MULTIPLE_LIMIT = 3;

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Reasons a typed winning bid looks like a typing mistake, checked against
 * the item's own Opening Bid, Minimum Raise and Value. Empty when it looks
 * fine. These are "are you sure?" prompts, not refusals - the person
 * entering bids can record it anyway after checking the bid sheet.
 *
 * - Below the opening bid: usually a dropped digit (150 typed as 15).
 * - Not the opening bid plus a whole number of minimum raises: bids go up
 *   only in those steps (a $10 opener with a $5 raise ends at $10, $15,
 *   $20...), so $22 can't be a winning bid.
 * - More than VALUE_MULTIPLE_LIMIT x the value: usually an extra digit.
 *
 * A field the item doesn't have (blank or $0) skips its check. The step
 * check is skipped for items not bid in steps (`steppedBidding`).
 */
export function bidWarnings(item: AuctionItem, price: number): string[] {
  const warnings: string[] = [];
  if (!(price > 0)) return ["The amount is $0."];

  const opening = parseDollar(item.openingBid);
  const minRaise = parseDollar(item.minRaise);
  const value = parseDollar(item.value);
  // Half a cent of slack, so 49.999 style float noise never trips a check.
  const EPS = 0.005;

  if (opening > 0 && price < opening - EPS) {
    warnings.push(`${money(price)} is below the opening bid of ${money(opening)}. Missing a digit?`);
  } else if (opening > 0 && minRaise > 0 && steppedBidding(item)) {
    const steps = (price - opening) / minRaise;
    const below = opening + Math.floor(steps + EPS / minRaise) * minRaise;
    if (price - below > EPS) {
      warnings.push(`${money(price)} isn't a possible winning bid: bids start at ${money(opening)} and go up in steps of ${money(minRaise)}. The nearest are ${money(below)} and ${money(below + minRaise)}.`);
    }
  }
  if (value > 0 && price > value * VALUE_MULTIPLE_LIMIT + EPS) {
    warnings.push(`${money(price)} is more than ${VALUE_MULTIPLE_LIMIT} times the item's value of ${money(value)}. An extra digit?`);
  }
  return warnings;
}
