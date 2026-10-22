/**
 * Server-side checks for record-winning-bid (ROADMAP.md Milestone A).
 *
 * Bid Entry already refuses a second winner for an item that allows only
 * one, but only from what that screen has loaded. A bid saved on a device
 * while it was offline, and resent later, can't know what other devices
 * recorded in the meantime, so the server checks too.
 */

export interface ExistingWin {
  bidderId: string;
  price: number;
}

/**
 * Every recorded win of `itemId` in a Bid-Management grid (row 1 holds
 * bidder IDs in ID/price column pairs; bids start on row 4) - the same
 * layout src/lib/bidGridParsing.ts reads.
 */
export function findExistingWins(grid: any[][], itemId: string): ExistingWin[] {
  const header = grid[0] || [];
  const wins: ExistingWin[] = [];
  const wanted = String(itemId).trim();
  for (let c = 0; c < header.length; c += 2) {
    const bidderId = String(header[c] ?? "").trim();
    if (!bidderId) continue;
    for (let r = 3; r < grid.length; r++) {
      if (String(grid[r]?.[c] ?? "").trim() === wanted) {
        wins.push({ bidderId, price: parseFloat(String(grid[r]?.[c + 1] ?? "").replace(/[^0-9.]/g, "")) || 0 });
      }
    }
  }
  return wins;
}

/**
 * Whether the Items sheet marks `itemId` as allowing more than one winner
 * (raffle tickets, Open Appeal tiers). Columns are found by header name
 * with the same fallbacks as src/lib/itemParsing.ts (ID in A, the flag in
 * M). Returns undefined when the item isn't listed, so the caller can
 * decide what an unknown item means.
 */
export function isRepeatableItem(itemRows: any[][], itemId: string): boolean | undefined {
  const headers = (itemRows[0] || []).map((h: any) => String(h ?? "").toLowerCase().trim());
  const col = (names: string[], fallback: number) => {
    const i = headers.findIndex((h: string) => names.some((n) => h === n || h.includes(n)));
    return i !== -1 ? i : fallback;
  };
  const idIdx = col(["item number", "number", "id"], 0);
  const flagIdx = col(["allow multiple winners", "multiple winners"], 12);
  const row = itemRows.slice(1).find((r) => String(r?.[idIdx] ?? "").trim() === String(itemId).trim());
  if (!row) return undefined;
  const flag = row[flagIdx];
  return flag === true || String(flag ?? "").toUpperCase() === "TRUE";
}

/** A one-winner item that already has a winner. The route answers 409. */
export class WinningBidConflictError extends Error {
  readonly code = "conflict";
}
