/**
 * The Dashboard's gift-card / raffle winner save (specialWinnerService.ts),
 * which replaced two direct writes through the generic /api/sheets
 * passthrough. Uses a fake Sheets client that records what was written
 * and which tabs exist.
 */
import { describe, it, expect } from "vitest";
import { saveSpecialWinner } from "../services/specialWinnerService";
import { withLock } from "../utils/asyncLock";

function fakeSheets(existingTabs: string[]) {
  const tabs = [...existingTabs];
  const log: string[] = [];
  const sheets = {
    spreadsheets: {
      get: async () => ({ data: { sheets: tabs.map((title) => ({ properties: { title } })) } }),
      batchUpdate: async ({ requestBody }: any) => {
        const title = requestBody.requests[0].addSheet.properties.title;
        tabs.push(title);
        log.push(`add tab ${title}`);
        return { data: {} };
      },
      values: {
        // The old winner, read so Action History can record it (not a write, so not logged).
        get: async () => ({ data: { values: [["5"]] } }),
        update: async ({ range, requestBody }: any) => {
          log.push(`update ${range} ${JSON.stringify(requestBody.values)}`);
          return { data: {} };
        },
        append: async ({ range, requestBody }: any) => {
          log.push(`append ${range} ${JSON.stringify(requestBody.values)}`);
          return { data: {} };
        },
      },
    },
  } as any;
  return { sheets, log };
}

describe("saveSpecialWinner", () => {
  it("writes the gift card winner to Special-Winners!B2 and nothing else for a bidder still checking out", async () => {
    const { sheets, log } = fakeSheets(["Special-Winners", "Follow-Up"]);
    const result = await saveSpecialWinner(sheets, { spreadsheetId: "bm", prize: "giftCard", bidderId: "12", addFollowUp: false });
    expect(log).toEqual([`update 'Special-Winners'!B2 [["12"]]`]);
    expect(result).toEqual({ success: true, range: "'Special-Winners'!B2", before: "5" });
  });

  it("writes the raffle winner to B3 and adds a Follow-Up row when they already checked out", async () => {
    const { sheets, log } = fakeSheets(["Special-Winners", "Follow-Up"]);
    await saveSpecialWinner(sheets, { spreadsheetId: "bm", prize: "raffle", bidderId: "7", addFollowUp: true });
    expect(log).toEqual([
      `update 'Special-Winners'!B3 [["7"]]`,
      `append 'Follow-Up'!A:C [["7","50/50 Raffle",""]]`,
    ]);
  });

  it("creates the Special-Winners and Follow-Up tabs (with Follow-Up's header) on a spreadsheet that has neither", async () => {
    const { sheets, log } = fakeSheets([]);
    await saveSpecialWinner(sheets, { spreadsheetId: "bm", prize: "giftCard", bidderId: "3", addFollowUp: true });
    expect(log).toEqual([
      "add tab Special-Winners",
      `update 'Special-Winners'!B2 [["3"]]`,
      "add tab Follow-Up",
      `update 'Follow-Up'!A1:C1 [["Bidder ID","Item ID","Amount"]]`,
      `append 'Follow-Up'!A:C [["3","$500 Amazon Gift Card",""]]`,
    ]);
  });

  it("clearing the winner (empty bidder) adds no Follow-Up row", async () => {
    const { sheets, log } = fakeSheets(["Special-Winners", "Follow-Up"]);
    await saveSpecialWinner(sheets, { spreadsheetId: "bm", prize: "giftCard", bidderId: "", addFollowUp: true });
    expect(log).toEqual([`update 'Special-Winners'!B2 [[""]]`]);
  });

  it("waits for the bidder-numbers lock that recordWinningBid's Follow-Up writes hold", async () => {
    const order: string[] = [];
    let release: () => void;
    const held = withLock("bidder-numbers:bm", async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      order.push("winning-bid-done");
    });
    const { sheets } = fakeSheets(["Special-Winners", "Follow-Up"]);
    const save = saveSpecialWinner(sheets, { spreadsheetId: "bm", prize: "raffle", bidderId: "7", addFollowUp: true })
      .then(() => order.push("special-winner-done"));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual([]);
    release!();
    await Promise.all([held, save]);
    expect(order).toEqual(["winning-bid-done", "special-winner-done"]);
  });
});
