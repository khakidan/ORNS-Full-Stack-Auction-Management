import { describe, it, expect, vi } from "vitest";
import { ensureTrackingHeaders, BIDDER_NUMBERS_HEADERS } from "../utils/bidderNumbersHeaders";

/** A minimal stand-in for the Sheets client: L1:O1 holds `current`, and updates are recorded. */
function fakeSheets(current: string[] | undefined) {
  const update = vi.fn().mockResolvedValue({});
  const get = vi.fn().mockResolvedValue({ data: { values: current ? [current] : undefined } });
  return { sheets: { spreadsheets: { values: { get, update } } } as any, get, update };
}

describe("ensureTrackingHeaders", () => {
  it("labels L1:O1 on a Bidder-Numbers tab built before those columns existed", async () => {
    const { sheets, update } = fakeSheets(undefined);

    await ensureTrackingHeaders(sheets, "ss-id");

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      range: "'Bidder-Numbers'!L1:O1",
      requestBody: { values: [["PayPal Pending Since", "Receipt Emailed At", "Receipt Emailed Invoice", "Ticket"]] },
    }));
  });

  it("fills only the blank cells and keeps a header someone typed in", async () => {
    const { sheets, update } = fakeSheets(["Pending Since (custom)", "", "", ""]);

    await ensureTrackingHeaders(sheets, "ss-id");

    expect(update.mock.calls[0][0].requestBody.values).toEqual([["Pending Since (custom)", "Receipt Emailed At", "Receipt Emailed Invoice", "Ticket"]]);
  });

  it("writes nothing when all four headers are already there", async () => {
    const { sheets, update } = fakeSheets(["a", "b", "c", "d"]);

    await ensureTrackingHeaders(sheets, "ss-id");

    expect(update).not.toHaveBeenCalled();
  });

  it("uses the configured Bidder-Numbers tab name", async () => {
    const { sheets, get } = fakeSheets(["a", "b", "c", "d"]);

    await ensureTrackingHeaders(sheets, "ss-id", "Bidders 2026");

    expect(get).toHaveBeenCalledWith({ spreadsheetId: "ss-id", range: "'Bidders 2026'!L1:O1" });
  });

  it("the full header row covers columns A-O", () => {
    expect(BIDDER_NUMBERS_HEADERS).toHaveLength(15);
    expect(BIDDER_NUMBERS_HEADERS[14]).toBe("Ticket");
    expect(BIDDER_NUMBERS_HEADERS.slice(9, 11)).toEqual(["Invoice URL", "Invoiced Amount"]);
  });
});
