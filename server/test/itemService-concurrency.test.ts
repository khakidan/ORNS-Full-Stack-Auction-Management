/**
 * Concurrency regression guard for itemService.ts/bundleService.ts's
 * Auction-Items-mutating functions - found in a hardening audit (see
 * docs/agents/refactor-opportunities.md's Code Hardening item #1 /
 * CHANGELOG.md). Each of addItem/deleteItem/updateItem/bulkUpdateItems/
 * processBundle/restoreBundle reads the full 'Auction-Items'!A:L range,
 * mutates the in-memory 2D array, then overwrites the whole range - none
 * previously used withLock. Two staff working the item-entry/bundling
 * workflow concurrently (a realistic pre-event pattern) could otherwise
 * both read the same snapshot, and the second write would silently
 * discard the first's change (an added item vanishing, a deleted item
 * reappearing, etc).
 *
 * Mirrors bidderService.test.ts's checkInBidderWithBid concurrency test:
 * gate the first call's read, prove the second call's own read doesn't
 * even start until the first has fully finished writing.
 */
import { describe, it, expect } from "vitest";
import { addItem } from "../services/itemService";

describe("itemService/bundleService Auction-Items lock (defense-in-depth)", () => {
  it("does not start a second concurrent addItem's Auction-Items read until the first one (same spreadsheet) has fully finished writing", async () => {
    const callOrder: string[] = [];
    let releaseFirst: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const header = [
      "Auction Item ID", "Category", "Item Name", "Description", "Value",
      "Opening Bid", "Min Raise Amount", "Donated By",
      "Physical Item, Certificate, or Both?", "Status", "Bundle ID", "Bundled Date/Time"
    ];
    let auctionItemsRows: any[][] = [header];

    let readCount = 0;
    const fake = {
      spreadsheets: {
        values: {
          get: async ({ range }: { range: string }) => {
            if (range.includes("Auction-Items")) {
              readCount++;
              const isFirst = readCount === 1;
              callOrder.push(isFirst ? "A-start" : "B-start");
              if (isFirst) await firstGate;
              return { data: { values: auctionItemsRows.map((r) => [...r]) } };
            }
            // Categories / Value Calculations reads: empty is fine.
            return { data: { values: [] } };
          },
          update: async ({ range, requestBody }: any) => {
            // addItem now also issues a single-cell write to column M
            // ("Allow Multiple Winners") ahead of the main row write -
            // excluded here so callOrder still tracks just the
            // full-row write this test cares about.
            if (range.includes("Auction-Items") && !range.includes("!M")) {
              auctionItemsRows = requestBody.values;
              callOrder.push(readCount === 1 ? "A-end" : "B-end");
            }
            return { data: {} };
          },
        },
      },
    } as any;

    const addA = addItem(fake, {
      spreadsheetId: "same-items-id", category: "Food", name: "Item A",
    });
    const addB = addItem(fake, {
      spreadsheetId: "same-items-id", category: "Food", name: "Item B",
    });

    // Fired both without awaiting either yet. Give both a moment to
    // actually reach the mocked read, then release A.
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseFirst!();

    const [resultA, resultB] = await Promise.all([addA, addB]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    // With the lock: B can't even start its own read until A fully
    // finishes writing. Without it: B (ungated) would read the header-only
    // snapshot, overwrite A's row entirely, and finish before A's gate is
    // ever released.
    expect(callOrder).toEqual(["A-start", "A-end", "B-start", "B-end"]);

    // The real, business-meaningful assertion: both items survive - not
    // one silently clobbering the other.
    const names = auctionItemsRows.slice(1).map((r) => r[2]);
    expect(names.sort()).toEqual(["Item A", "Item B"]);
  });
});
