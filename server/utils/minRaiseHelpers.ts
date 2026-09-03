/**
 * Shared minimum-raise tier logic for Auction-Items. Both `itemService.ts`
 * (adding a single item) and `bundleService.ts` (bundling several) need to
 * compute a default min raise from a value, using the "Value Calculations"
 * tab's tiers when configured, and this same hardcoded ladder - matching
 * what a real "Value Calculations" tab is set up with - when it isn't.
 * Previously each file had its own divergent fallback (a flat $5 in
 * itemService.ts vs. this ladder in bundleService.ts), so adding an item
 * vs. bundling one at the same value produced different minimum raises
 * whenever no "Value Calculations" tab was configured.
 */
export interface MinRaiseTier {
  minRange: number;
  minRaise: number;
}

export function calculateMinRaiseAmount(value: number, tiers: MinRaiseTier[]): number {
  if (tiers.length > 0) {
    const sorted = [...tiers].sort((a, b) => a.minRange - b.minRange);
    let amount = 5;
    for (const tier of sorted) {
      if (value >= tier.minRange) {
        amount = tier.minRaise;
      }
    }
    return amount;
  }

  if (value < 150) return 5;
  if (value < 300) return 10;
  if (value < 450) return 15;
  if (value < 600) return 20;
  if (value < 750) return 30;
  if (value < 900) return 40;
  return 50;
}
