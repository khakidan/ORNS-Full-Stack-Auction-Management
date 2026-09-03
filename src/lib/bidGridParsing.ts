export interface BidGridWin {
  bidderId: string;
  itemId: string;
  price: number;
}

/**
 * Parses the Bid-Management sheet's column-pair grid (each bidder gets one
 * two-column block: winning item ID, then price) into a flat list of wins.
 *
 * `useCheckoutState.ts` and `useWinnersData.ts` previously each hand-rolled
 * a near-identical but subtly different version of this parse: different
 * cell guards (requiring both the item ID and price cell to be present, vs.
 * just the item ID) and different fetch ranges (`!1:100`, capped well below
 * the up-to-300 rows `server/services/auctionService.ts`'s `recordWinningBid`
 * can write into, vs. the effectively unbounded `!A:ZZ`). That let the two
 * screens disagree about which items counted as won on a large enough
 * auction. This is the one shared implementation both now use - matching
 * the looser cell guard and wider range, since `Items.tsx` already relies
 * on an item with a recorded winner but a blank/malformed price cell still
 * counting as won (price simply defaults to 0 in that case).
 *
 * @param values Raw `getSheetData(...).values` for the Bid-Management sheet.
 */
export function parseBidGrid(values: string[][] | undefined | null): BidGridWin[] {
  if (!values || values.length < 4) return [];

  const header = values[0];
  const wins: BidGridWin[] = [];

  for (let j = 0; j < header.length; j += 2) {
    const bidderId = header[j]?.toString();
    if (!bidderId) continue;

    for (let i = 3; i < values.length; i++) {
      const row = values[i];
      if (row && row[j]) {
        const itemId = row[j].toString();
        const priceVal = row[j + 1]?.toString().replace(/[^0-9.]/g, "") || "0";
        const price = parseFloat(priceVal) || 0;
        wins.push({ bidderId, itemId, price });
      }
    }
  }

  return wins;
}
