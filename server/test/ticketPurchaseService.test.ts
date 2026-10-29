/**
 * upsertTicketPurchase: one website purchase -> at most one `tickets` row,
 * found by its Fluent Forms entry ID (ROADMAP W2).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/bidderTicketSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/bidderTicketSync")>()),
  syncBiddersWith: vi.fn(async () => ({ renamed: [], added: [], unlinked: [] })),
}));

vi.mock("../services/ticketsAfterGoLive", () => ({ noteIfAfterGoLive: vi.fn(async () => false) }));

import { upsertTicketPurchase, FLUENT_FORMS } from "../services/ticketPurchaseService";
import { noteIfAfterGoLive } from "../services/ticketsAfterGoLive";
import { TicketPurchase } from "../services/ticketPurchaseRow";
import { syncBiddersWith } from "../services/bidderTicketSync";
import { logSystemAction } from "../services/actionLog";
import { getAdminFirestore } from "../services/firebaseAdmin";

const purchase = (overrides: Partial<TicketPurchase> = {}): TicketPurchase => ({
  entryId: "1500",
  firstName: "Pat",
  lastName: "Lee",
  email: "pat@example.com",
  phone: "555-0100",
  tickets: 2,
  guests: [{ firstName: "Sam", lastName: "Lee", email: "sam@example.com", ownBidderNumber: true }],
  paymentMethod: "paypal",
  paymentStatus: "paid",
  total: 70,
  ...overrides,
});

/** A tickets tab whose column W grows as rows are appended. */
function fakeSheets(entryIds: string[] = []) {
  const column = [["Form Entry ID"], ...entryIds.map((id) => [id])];
  const appended: unknown[][] = [];
  const sheets = {
    spreadsheets: {
      values: {
        get: vi.fn(async ({ range }: { range: string }) => {
          expect(range).toBe("'tickets'!W:W");
          // What the tab holds when the read starts; the answer arrives a
          // little later, so a second caller can read before the first appends.
          const snapshot = column.map((r) => [...r]);
          await new Promise((r) => setTimeout(r, 5));
          return { data: { values: snapshot } };
        }),
        append: vi.fn(async ({ requestBody }: any) => {
          const row = requestBody.values[0];
          appended.push(row);
          column.push([row[22]]);
          return { data: { updates: { updatedRange: `'tickets'!A${column.length}:W${column.length}` } } };
        }),
      },
    },
  };
  return { sheets: sheets as any, appended };
}

const review = () => getAdminFirestore().collection("ticketPurchaseReview");

beforeEach(async () => {
  vi.mocked(syncBiddersWith).mockClear();
  await getAdminFirestore().collection("settings").doc("global").set({ auctionTicketsSpreadsheetId: "tk" });
});

describe("upsertTicketPurchase - purchases after Go Live (W7)", () => {
  beforeEach(() => vi.mocked(noteIfAfterGoLive).mockClear().mockResolvedValue(false));

  it("checks every purchase it places - added, already there, or (shadow mode) would add - with its row", async () => {
    await upsertTicketPurchase(fakeSheets(["1400"]).sheets, purchase(), { mode: "write" });
    await upsertTicketPurchase(fakeSheets(["1400", "1500"]).sheets, purchase(), { mode: "write" });
    await upsertTicketPurchase(fakeSheets(["1400"]).sheets, purchase(), { mode: "compare" });

    expect(vi.mocked(noteIfAfterGoLive).mock.calls.map(([, p, row]) => [p.entryId, row])).toEqual([["1500", 3], ["1500", 3], ["1500", null]]);
  });

  it("doesn't check one that can't be written, and a failed check never fails the purchase", async () => {
    await upsertTicketPurchase(fakeSheets().sheets, purchase({ tickets: 0 }), { mode: "write" });
    expect(noteIfAfterGoLive).not.toHaveBeenCalled();

    vi.mocked(noteIfAfterGoLive).mockRejectedValueOnce(new Error("Sheets said no"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(upsertTicketPurchase(fakeSheets().sheets, purchase(), { mode: "write" })).resolves.toMatchObject({ outcome: "added" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("entry 1500"), "Sheets said no");
    warn.mockRestore();
  });
});

describe("upsertTicketPurchase", () => {
  it("appends a new purchase, records it as Fluent Forms, and brings the bidders in line", async () => {
    const { sheets, appended } = fakeSheets(["1400"]);

    const result = await upsertTicketPurchase(sheets, purchase(), { mode: "write" });

    expect(result).toEqual({ outcome: "added", entryId: "1500", rowIndex: 3 });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toEqual(expect.arrayContaining(["Pat", "Lee", "PayPal", "Pending", "$70", "1500"]));
    expect(sheets.spreadsheets.values.append).toHaveBeenCalledWith(expect.objectContaining({ spreadsheetId: "tk", valueInputOption: "USER_ENTERED" }));
    expect(vi.mocked(logSystemAction)).toHaveBeenCalledWith(sheets, FLUENT_FORMS, expect.objectContaining({ area: "Tickets", action: "Add ticket purchase", target: "Pat Lee" }));
    expect(syncBiddersWith).toHaveBeenCalledTimes(1);
  });

  it("leaves a purchase that already has a row alone - staff edits to it win", async () => {
    const { sheets, appended } = fakeSheets(["1400", "1500"]);

    const result = await upsertTicketPurchase(sheets, purchase(), { mode: "write" });

    expect(result).toEqual({ outcome: "exists", entryId: "1500", rowIndex: 3 });
    expect(appended).toHaveLength(0);
    expect(syncBiddersWith).not.toHaveBeenCalled();
  });

  it("adds a purchase once when the webhook and the poll bring it at the same moment", async () => {
    const { sheets, appended } = fakeSheets();

    const results = await Promise.all([
      upsertTicketPurchase(sheets, purchase(), { mode: "write" }),
      upsertTicketPurchase(sheets, purchase(), { mode: "write" }),
    ]);

    expect(appended).toHaveLength(1);
    expect(results.map((r) => r.outcome).sort()).toEqual(["added", "exists"]);
  });

  it("in compare mode (shadow) says what it would do and writes nothing", async () => {
    const { sheets, appended } = fakeSheets();

    const result = await upsertTicketPurchase(sheets, purchase(), { mode: "compare" });

    expect(result).toMatchObject({ outcome: "would-add", entryId: "1500" });
    expect(appended).toHaveLength(0);
    expect(vi.mocked(logSystemAction)).not.toHaveBeenCalled();
    expect(syncBiddersWith).not.toHaveBeenCalled();
  });

  it("puts a purchase it can't write on the review list, with only the ID, name and problems", async () => {
    const { sheets, appended } = fakeSheets();

    const result = await upsertTicketPurchase(sheets, purchase({ tickets: 0, guests: [] }), { mode: "write" });

    expect(result).toMatchObject({ outcome: "needs-review", entryId: "1500" });
    expect(appended).toHaveLength(0);
    const stored = (await review().doc("1500").get()).data();
    expect(stored).toEqual({ entryId: "1500", name: "Pat Lee", problems: [expect.stringContaining("number of tickets")], firstSeenAt: expect.any(String), lastSeenAt: expect.any(String) });
  });

  it("doesn't touch the review list in compare mode", async () => {
    const { sheets } = fakeSheets();

    await upsertTicketPurchase(sheets, purchase({ tickets: 0, guests: [] }), { mode: "compare" });

    expect((await review().doc("1500").get()).exists).toBe(false);
  });

  it("takes a purchase off the review list once it's been written", async () => {
    const { sheets } = fakeSheets();
    await upsertTicketPurchase(sheets, purchase({ tickets: 0, guests: [] }), { mode: "write" });

    await upsertTicketPurchase(sheets, purchase(), { mode: "write" });

    expect((await review().doc("1500").get()).exists).toBe(false);
  });

  it("refuses when the Config has no Auction Tickets spreadsheet", async () => {
    await getAdminFirestore().collection("settings").doc("global").set({});
    const { sheets } = fakeSheets();

    await expect(upsertTicketPurchase(sheets, purchase(), { mode: "write" })).rejects.toThrow("Auction Tickets Spreadsheet ID");
  });
});
