export function getCategoryBase(categoryName: string): number {
  if (!categoryName) return 1;
  const clean = categoryName.toLowerCase().replace(/&/g, "and").trim().replace(/\s+/g, " ");
  
  if (clean.includes("classroom art")) return 101;
  if (clean.includes("arts, crafts and jewelry") || clean.includes("arts, crafts & jewelry") || clean.includes("jewelry")) return 201;
  if (clean.includes("health & beauty") || clean.includes("health and beauty") || clean.includes("health") || clean.includes("beauty")) return 301;
  if (clean.includes("fitness")) return 401;
  if (clean.includes("kids activities") || clean.includes("kids activity") || clean.includes("kids")) return 501;
  if (clean.includes("retail")) return 601;
  if (clean.includes("entertainment") || clean.includes("experience")) return 701;
  if (clean.includes("food")) return 801;
  if (clean.includes("service")) return 901;
  if (clean.includes("classroom baskets") || clean.includes("classroom basket")) return 1001;
  if (clean.includes("travel")) return 1101;
  // Checked before the generic "ticket" match below, which would
  // otherwise misroute "Auction Tickets" to the Sports/Tickets base
  // (1201) since it also contains the substring "ticket".
  if (clean.includes("auction ticket")) return AUCTION_TICKETS_CATEGORY_BASE;
  if (clean.includes("sports") || clean.includes("sports memorabilia") || clean.includes("ticket")) {
    if (clean.includes("raffle")) return 1501;
    return 1201;
  }
  if (clean.includes("live")) return 1301;
  if (clean.includes("movie")) return 1401;
  if (clean.includes("raffle")) return 1501;
  if (clean.includes("open appeal") || clean.includes("appeal")) return 1601;

  // Exact fallback matches
  const exactMatches: Record<string, number> = {
    "classroom art": 101,
    "arts, crafts and jewelry": 201,
    "arts, crafts & jewelry": 201,
    "health & beauty": 301,
    "health and beauty": 301,
    "fitness": 401,
    "kids activities": 501,
    "retail": 601,
    "entertainment & experiences": 701,
    "entertainment and experiences": 701,
    "food": 801,
    "services": 901,
    "classroom baskets": 1001,
    "travel": 1101,
    "sports memorabilia & tickets": 1201,
    "sports memorabilia and tickets": 1201,
    "live": 1301,
    "movie night": 1401,
    "raffle tickets": 1501,
    "open appeal": 1601,
    "auction tickets": AUCTION_TICKETS_CATEGORY_BASE
  };
  return exactMatches[clean] || 1;
}

/** See server/utils/categoryHelpers.ts's copy of this constant for the full rationale. */
export const AUCTION_TICKETS_CATEGORY_BASE = 1701;
