import { BIDDER_COL, BID_GRID_FIRST_BID_ROW_INDEX } from "./sheetColumns";

/**
 * Lookups in the Bid-Management grid and Bidder-Numbers rows, shared by
 * every writer (winning bids, check-in with a ticket bid, receipts, the
 * flag and checkout routes) instead of each keeping its own loop.
 */

/**
 * A bidder's 0-based column in the Bid-Management grid: the ID sits in
 * row 1 of the first column of their item/price pair. -1 when absent.
 */
export function findBidderColumn(gridRows: unknown[][], bidderId: string): number {
  const headerRow = gridRows[0] || [];
  for (let c = 0; c < headerRow.length; c += 2) {
    if (String(headerRow[c] ?? "").trim() === String(bidderId).trim()) return c;
  }
  return -1;
}

/**
 * The 1-based sheet row for a bidder's next bid: the first row from row 4
 * down whose item cell in their column is empty, or the row after the
 * last one read.
 */
export function firstEmptyBidRow(gridRows: unknown[][], colIndex: number): number {
  for (let i = BID_GRID_FIRST_BID_ROW_INDEX; i < gridRows.length; i++) {
    if (!gridRows[i] || !gridRows[i][colIndex]) return i + 1;
  }
  return Math.max(gridRows.length + 1, BID_GRID_FIRST_BID_ROW_INDEX + 1);
}

/** A bidder's 0-based row index in Bidder-Numbers rows (header at index 0), or -1. */
export function findBidderRowIndex(bidderRows: unknown[][], bidderId: string): number {
  for (let i = 1; i < bidderRows.length; i++) {
    if (String(bidderRows[i]?.[BIDDER_COL.id] ?? "").trim() === String(bidderId).trim()) return i;
  }
  return -1;
}
