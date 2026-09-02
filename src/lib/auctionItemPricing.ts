export interface ValueCalculationTier {
  minRange: number;
  minRaise: number;
}

export function parseDollar(val: string): number {
  if (!val) return 0;
  const parsed = parseFloat(val.replace(/[^0-9.-]+/g, ""));
  return isNaN(parsed) ? 0 : parsed;
}

export function calculateAutoBids(valStr: string, valueCalculations: ValueCalculationTier[]) {
  const v = parseDollar(valStr);
  let opening = "";
  let raise = "";
  if (v > 0) {
    opening = `$${(v * 0.45).toFixed(2)}`;

    let calculatedRaise = 5;
    if (valueCalculations.length > 0) {
      const sorted = [...valueCalculations].sort((a, b) => a.minRange - b.minRange);
      for (const tier of sorted) {
        if (v >= tier.minRange) {
          calculatedRaise = tier.minRaise;
        }
      }
    } else {
      if (v < 150) calculatedRaise = 5;
      else if (v < 300) calculatedRaise = 10;
      else if (v < 450) calculatedRaise = 15;
      else if (v < 600) calculatedRaise = 20;
      else if (v < 750) calculatedRaise = 30;
      else if (v < 900) calculatedRaise = 40;
      else calculatedRaise = 50;
    }
    raise = `$${calculatedRaise.toFixed(2)}`;
  }
  return { opening, raise };
}
