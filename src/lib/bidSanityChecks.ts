import { parseDollar } from "@/lib/auctionItemPricing";
import { AuctionItem } from "@/types";

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
 * - More than the opening bid but by less than the minimum raise: a bid
 *   sheet can't end there (each bid must beat the last by at least the
 *   minimum raise). Larger raises are allowed, so other amounts pass.
 * - More than VALUE_MULTIPLE_LIMIT x the value: usually an extra digit.
 *
 * A field the item doesn't have (blank or $0) skips its check.
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
  } else if (opening > 0 && minRaise > 0 && price > opening + EPS && price < opening + minRaise - EPS) {
    warnings.push(`${money(price)} is more than the opening bid (${money(opening)}) by less than the minimum raise of ${money(minRaise)}, so it can't be a winning bid. The lowest possible after the opening bid is ${money(opening + minRaise)}.`);
  }
  if (value > 0 && price > value * VALUE_MULTIPLE_LIMIT + EPS) {
    warnings.push(`${money(price)} is more than ${VALUE_MULTIPLE_LIMIT} times the item's value of ${money(value)}. An extra digit?`);
  }
  return warnings;
}
