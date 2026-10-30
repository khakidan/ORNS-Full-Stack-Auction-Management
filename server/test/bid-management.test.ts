/**
 * Test suite for the Bid Management workflow.
 * Covers endpoints related to recording winning bids, checking out, walk-in registrations,
 * checking in with starting bids, and auction closing & cleanup.
 */
import { authCookieHeader } from "./helpers/session";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { server } from "./setup";
import { http, HttpResponse } from "msw";
import { resetHandlersState, lastBulkWritePayload, updateCallCount,
         appendCallCount, lastAppendedRow,
         valuesBatchUpdateRequests } from "./handlers";
import { _resetIdempotencyForTesting } from "../utils/idempotency";
import { logAction } from "../services/actionLog";
import { changesSince } from "../utils/changeFeed";
import { syncBiddersFromTickets } from "../services/bidderTicketSync";
import { TICKETS_COL } from "../utils/sheetColumns";

const mockTokens = {
  access_token: "workflow-mock-token",
  refresh_token: "workflow-mock-refresh",
  expiry_date: Date.now() + 3600000
};
const authHeader = authCookieHeader(mockTokens);

describe("bidRoutes - Legacy Compatibility & Error Handling", () => {
  it("handles a Google API 429 Rate Limit error gracefully via errorHandler middleware", async () => {
    // Simulate Google API rate limits throwing exceptions via MSW
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
        return new HttpResponse(
          JSON.stringify({ error: { message: "Quota exceeded for quota metric 'Read requests'", status: "RESOURCE_EXHAUSTED" } }),
          { status: 429 }
        );
      })
    );

    const response = await request(app)
      .post("/api/auction/close-and-cleanup")
      .set(authHeader)
      .send({
        spreadsheetId: "test-sheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        bidManagementSheet: "Bid-Management",
      });

    // errorHandler now forwards the real status Google's client library
    // attaches to the thrown error (429) instead of forcing 500 for
    // every error indiscriminately - this is also what actually lets
    // fetchWithRetry's client-side retry/backoff (which checks for
    // exactly 429 or 5xx) engage correctly for a real rate-limit error.
    expect(response.status).toBe(429);
    expect(response.body).toHaveProperty("message");
    expect(response.body.message).toContain("Quota exceeded");
  });
});

describe("bidRoutes - /api/auction/record-winning-bid", () => {
  const validBody = {
    bidderId: "1001",
    itemId: "I01",
    price: 100,
    spreadsheetId: "ss-id",
    bidManagementSheet: "Bid-Management",
    bidderNumbersSheet: "Bidder-Numbers",
    idempotencyKey: "unique-key-1"
  };

  // Shared mock generator for bidRoutes tests
  const setupBidMocks = () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = url.pathname.split('/').pop() || "";
        
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "Name", "", "", "", "", "Checked Out"],
              ["1001", "Test User", "", "", "", "", false]
            ]
          });
        }
        if (range.includes("Bid-Management")) {
          return HttpResponse.json({
            values: [
              ["1001", "Price", "1002", "Price"],
              ["Total", "", "", ""],
              ["", "", "", ""],
              ["", "", "", ""] // Row 4
            ]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );
  };

  it("records a winning bid successfully", async () => {
    setupBidMocks();

    const response = await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({ ...validBody, idempotencyKey: "success-key-workflow" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(lastBulkWritePayload).not.toBeNull();
    expect(lastBulkWritePayload).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([validBody.itemId, validBody.price])
      ])
    );
  });

  it("returns cached response for duplicate idempotency key", async () => {
    setupBidMocks();
    const key = "dup-key-workflow";
    
    // First request
    await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({ ...validBody, idempotencyKey: key });

    // Second request
    const response = await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({ ...validBody, idempotencyKey: key });

    expect(response.status).toBe(200);
    expect(response.body.duplicated).toBe(true);
  });

  it("returns 400 if bidder is not found", async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
        return HttpResponse.json({ values: [["Header"], ["9999", "Other"]] });
      })
    );

    const response = await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({ ...validBody, idempotencyKey: "not-found-key-workflow" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Bidder 1001 not found");
  });

  // Regression guard for the hardening audit's finding: the old `!price`
  // check only rejected falsy values, not non-numeric ones. A non-numeric
  // price used to get stored as-is, and receiptDataService.ts's
  // resolveWonItems (`parseFloat(...) || 0`) would then silently treat it
  // as $0 - the item recorded as "won" but invoiced for nothing. See
  // docs/agents/CHANGELOG.md's Code Hardening item #1 /
  // CHANGELOG.md.
  it("returns 400 for a non-numeric price instead of silently recording it", async () => {
    setupBidMocks();

    const response = await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({ ...validBody, price: "not-a-number", idempotencyKey: "bad-price-key-workflow" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("price must be a valid number");
  });

  it("accepts a numeric-string price by coercing it to a number", async () => {
    setupBidMocks();

    const response = await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({ ...validBody, price: "150.50", idempotencyKey: "numeric-string-price-key-workflow" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(lastBulkWritePayload).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([validBody.itemId, 150.5])
      ])
    );
  });
});

describe("bidRoutes - /api/auction/record-winning-bid - one winner per item and durable resends (Milestone A)", () => {
  const body = {
    bidderId: "1002",
    itemId: "I01",
    price: 100,
    spreadsheetId: "ss-id",
    itemsSpreadsheetId: "items-id",
    bidManagementSheet: "Bid-Management",
    bidderNumbersSheet: "Bidder-Numbers",
  };

  /** Bidder 1001 already won I01 at $100. `repeatable` is I01's Items-sheet flag. */
  function mockSheets(opts: { repeatable?: boolean; itemsFail?: boolean } = {}) {
    const writes: string[] = [];
    let itemsReads = 0;
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ params }) => {
        const range = decodeURIComponent(String(params.range));
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({ values: [["ID", "Name", "", "", "", "", "Checked Out"], ["1001", "A", "", "", "", "", false], ["1002", "B", "", "", "", "", false]] });
        }
        if (range.includes("Bid-Management")) {
          return HttpResponse.json({ values: [["1001", "Price", "1002", "Price"], ["Total", "", "", ""], ["", "", "", ""], ["I01", "$100.00", "", ""]] });
        }
        if (range.includes("Auction-Items")) {
          itemsReads++;
          if (opts.itemsFail) return HttpResponse.json({ error: { code: 403, message: "no access" } }, { status: 403 });
          return HttpResponse.json({ values: [["Item Number", "Category", "Item Name", "", "", "", "", "", "", "", "", "", "Allow Multiple Winners"], ["I01", "Trips", "Cabin", "", "", "", "", "", "", "", "", "", opts.repeatable ? true : false]] });
        }
        return HttpResponse.json({ values: [] });
      }),
      http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ params }) => {
        writes.push(decodeURIComponent(String(params.range)));
        return HttpResponse.json({ updatedRows: 1 });
      })
    );
    return { writes, itemsReads: () => itemsReads };
  }

  it("refuses a second winner for a one-winner item with 409, writing nothing", async () => {
    const { writes } = mockSheets({ repeatable: false });

    const response = await request(app).post("/api/auction/record-winning-bid").set(authHeader)
      .send({ ...body, idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Item #I01 already has a winning bid (bidder 1001, $100.00), so this bid wasn't recorded.");
    expect(writes).toEqual([]);
  });

  it("treats the same bidder at the same price as already recorded - a resend whose first answer was lost - and writes nothing", async () => {
    const { writes } = mockSheets({ repeatable: false });

    const response = await request(app).post("/api/auction/record-winning-bid").set(authHeader)
      .send({ ...body, bidderId: "1001", idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, alreadyRecorded: true });
    expect(writes).toEqual([]);
  });

  it("records another winner when the item allows multiple winners", async () => {
    const { writes } = mockSheets({ repeatable: true });

    const response = await request(app).post("/api/auction/record-winning-bid").set(authHeader)
      .send({ ...body, idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(200);
    expect(writes.some((r) => r.includes("Bid-Management"))).toBe(true);
  });

  it("doesn't read the Items sheet when the item has no winner yet", async () => {
    const { itemsReads } = mockSheets({ repeatable: false });

    const response = await request(app).post("/api/auction/record-winning-bid").set(authHeader)
      .send({ ...body, itemId: "I02", idempotencyKey: crypto.randomUUID() });

    expect(response.status).toBe(200);
    expect(itemsReads()).toBe(0);
  });

  it("skips the check (as before) when the request has no itemsSpreadsheetId, or the Items sheet can't be read", async () => {
    const { itemsSpreadsheetId: _omit, ...noItems } = body;
    mockSheets({ repeatable: false });
    const withoutId = await request(app).post("/api/auction/record-winning-bid").set(authHeader)
      .send({ ...noItems, idempotencyKey: crypto.randomUUID() });
    expect(withoutId.status).toBe(200);

    mockSheets({ itemsFail: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const unreadable = await request(app).post("/api/auction/record-winning-bid").set(authHeader)
      .send({ ...body, idempotencyKey: crypto.randomUUID() });
    expect(unreadable.status).toBe(200);
  });

  it("answers a resend after a server restart from the durable record, without recording the bid again", async () => {
    const { writes } = mockSheets({ repeatable: false });
    const key = crypto.randomUUID();
    const first = await request(app).post("/api/auction/record-winning-bid").set(authHeader)
      .send({ ...body, itemId: "I02", idempotencyKey: key });
    expect(first.status).toBe(200);
    const writesAfterFirst = writes.length;

    // A restart (or Cloud Run scaling to zero) empties the in-memory map.
    _resetIdempotencyForTesting();

    const resend = await request(app).post("/api/auction/record-winning-bid").set(authHeader)
      .send({ ...body, itemId: "I02", idempotencyKey: key });
    expect(resend.status).toBe(200);
    expect(resend.body.duplicated).toBe(true);
    expect(writes.length).toBe(writesAfterFirst);
  });
});

describe("bidRoutes - /api/bidders/walk-in", () => {
  it("performs walk-in successfully", async () => {
    const version = changesSince(0).version;
    const response = await request(app)
      .post("/api/bidders/walk-in")
      .set(authHeader)
      .send({
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        spreadsheetId: "ss-id",
        bidderNumbersSheet: "Bidder-Numbers",
        bidManagementSheet: "Bid-Management",
        idempotencyKey: "walkin-key-1"
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.bidder.firstName).toBe("John");
    expect(lastAppendedRow).not.toBeNull();
    expect(lastAppendedRow[1]).toBe("John");
    expect(lastAppendedRow[2]).toBe("Doe");
    expect(lastAppendedRow[3]).toBe("john@example.com");
    expect(lastAppendedRow[4]).toBe(true);
    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      area: "Bid Management",
      action: "Register walk-in",
      target: `Bidder ${response.body.bidder.id}`,
      summary: `Registered walk-in John Doe as bidder ${response.body.bidder.id}`,
      // ticketPrice comes from the Config, not the request.
      after: { firstName: "John", lastName: "Doe", email: "john@example.com", ticketPrice: "35" },
      notUndoableReason: expect.stringMatching(/\S/),
    }));
    expect(changesSince(version).changed).toContain("ss-id");
  });

  describe("with the tickets spreadsheet", () => {
    let ticketAppends: string[][];
    beforeEach(() => {
      ticketAppends = [];
      vi.mocked(syncBiddersFromTickets).mockClear();
      server.use(
        http.get("https://sheets.googleapis.com/v4/spreadsheets/:id", ({ params }) =>
          params.id === "tk-id" ? HttpResponse.json({ sheets: [{ properties: { title: "Tickets" } }] }) : undefined),
        http.post("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range\\:append", async ({ params, request }) => {
          if (params.id !== "tk-id") return undefined;
          ticketAppends.push(...((await request.json()) as any).values);
          return HttpResponse.json({ updates: {} });
        }),
      );
    });
    const walkIn = (extra: Record<string, unknown>) => request(app).post("/api/bidders/walk-in").set(authHeader)
      .send({ firstName: "John", lastName: "Doe", email: "john@example.com", spreadsheetId: "ss-id", ...extra });

    it("adds their ticket at the Config's price, tells open browsers about both spreadsheets, and ties the bidder to it", async () => {
      const version = changesSince(0).version;

      const response = await walkIn({ ticketsSpreadsheetId: "tk-id", idempotencyKey: "walkin-ticket-1" });

      expect(response.status).toBe(200);
      expect(response.body.ticketAppended).toBe(true);
      expect(ticketAppends).toHaveLength(1);
      const row = ticketAppends[0];
      expect([row[TICKETS_COL.firstName], row[TICKETS_COL.lastName], row[TICKETS_COL.email]]).toEqual(["John", "Doe", "john@example.com"]);
      expect([row[TICKETS_COL.ticketsPurchased], row[TICKETS_COL.paymentMethod], row[TICKETS_COL.paymentStatus], row[TICKETS_COL.totalPaid]])
        .toEqual(["1", "Auction Checkout", "Pending", "$35"]);
      expect(changesSince(version).changed).toEqual(expect.arrayContaining(["ss-id", "tk-id"]));
      expect(syncBiddersFromTickets).toHaveBeenCalledTimes(1);
    });

    it("doesn't run the ticket sync when there's no tickets spreadsheet", async () => {
      const response = await walkIn({ idempotencyKey: "walkin-ticket-2" });

      expect(response.status).toBe(200);
      expect(response.body.ticketAppended).toBe(false);
      expect(ticketAppends).toEqual([]);
      expect(syncBiddersFromTickets).not.toHaveBeenCalled();
    });
  });

  it("returns 400 when the name is missing", async () => {
    const response = await request(app)
      .post("/api/bidders/walk-in")
      .set(authHeader)
      .send({
        lastName: "Doe",
        spreadsheetId: "ss-id",
        idempotencyKey: "walkin-key-bad"
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Missing required fields for walk-in");
  });

  it("uses the Config's tab names, not the request's - a stale browser can't name the wrong tab (ROADMAP A13)", async () => {
    const ranges: string[] = [];
    server.use(http.get("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", ({ params }) => {
      ranges.push(decodeURIComponent(String(params.range)));
      return HttpResponse.json({ values: [] });
    }));

    await request(app).post("/api/bidders/walk-in").set(authHeader)
      .send({ firstName: "John", lastName: "Doe", spreadsheetId: "ss-id", bidderNumbersSheet: "Old-Bidders", bidManagementSheet: "Old-Grid", idempotencyKey: "walkin-stale" });

    expect(ranges.some((r) => r.includes("Old-Bidders") || r.includes("Old-Grid"))).toBe(false);
    expect(ranges.some((r) => r.includes("Bidder-Numbers"))).toBe(true);
  });
});

describe("bidRoutes - /api/auction/special-winner", () => {
  const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
  let writes: string[];

  /** A Bid Management spreadsheet with both tabs, whose gift card winner is bidder 5. */
  beforeEach(() => {
    writes = [];
    server.use(
      http.get(`${SHEETS}/:id`, () => HttpResponse.json({ sheets: [{ properties: { title: "Special-Winners" } }, { properties: { title: "Follow-Up" } }] })),
      http.get(`${SHEETS}/:id/values/:range`, ({ params }) =>
        HttpResponse.json({ values: decodeURIComponent(String(params.range)) === "'Special-Winners'!B2" ? [["5"]] : [] })),
      http.put(`${SHEETS}/:id/values/:range`, async ({ params, request }) => {
        writes.push(`update ${params.id} ${decodeURIComponent(String(params.range))} ${JSON.stringify(((await request.json()) as any).values)}`);
        return HttpResponse.json({});
      }),
      http.post(`${SHEETS}/:id/values/:range\\:append`, async ({ params, request }) => {
        writes.push(`append ${params.id} ${decodeURIComponent(String(params.range))} ${JSON.stringify(((await request.json()) as any).values)}`);
        return HttpResponse.json({ updates: {} });
      }),
    );
  });

  const save = (body: Record<string, unknown>) => request(app).post("/api/auction/special-winner").set(authHeader).send({ spreadsheetId: "bm", ...body });

  it.each([
    ["an unknown prize", { prize: "toString", bidderId: "12" }],
    ["a bidder number that isn't a string", { prize: "giftCard", bidderId: 12 }],
  ])("refuses %s with 400, writing nothing", async (_label, body) => {
    const res = await save(body);

    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
    expect(logAction).not.toHaveBeenCalled();
  });

  it("saves the winner, and records it in Action History with an undo back to the old winner", async () => {
    const version = changesSince(0).version;

    const res = await save({ prize: "giftCard", bidderId: " 12 ", addFollowUp: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, range: "'Special-Winners'!B2", before: "5" });
    expect(writes).toEqual([`update bm 'Special-Winners'!B2 [["12"]]`]);
    expect(logAction).toHaveBeenCalledWith(expect.anything(), {
      area: "Bid Management",
      action: "Set special winner",
      target: "$500 Amazon Gift Card",
      summary: "$500 Amazon Gift Card winner: bidder 12",
      before: "5",
      after: "12",
      location: "Bid Management 'Special-Winners'!B2",
      undo: { kind: "cells", spreadsheetId: "bm", range: "'Special-Winners'!B2", before: [["5"]], after: [["12"]], lock: "bidder-numbers:bm" },
    });
    expect(changesSince(version).changed).toContain("bm");
  });

  it("clears the winner with an empty bidder number", async () => {
    const res = await save({ prize: "giftCard", bidderId: "", addFollowUp: true });

    expect(res.status).toBe(200);
    expect(writes).toEqual([`update bm 'Special-Winners'!B2 [[""]]`]);
    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      summary: "Cleared the $500 Amazon Gift Card winner", before: "5", after: undefined,
    }));
  });

  it("adds a Follow-Up row only when asked (the winner already checked out)", async () => {
    await save({ prize: "raffle", bidderId: "7", addFollowUp: true });
    expect(writes).toEqual([`update bm 'Special-Winners'!B3 [["7"]]`, `append bm 'Follow-Up'!A:C [["7","50/50 Raffle",""]]`]);

    writes.length = 0;
    await save({ prize: "raffle", bidderId: "7", addFollowUp: false });
    expect(writes).toEqual([`update bm 'Special-Winners'!B3 [["7"]]`]);
  });

  it("writes once for a resend with the same key", async () => {
    const body = { prize: "raffle", bidderId: "7", addFollowUp: true, idempotencyKey: "special-winner-once" };

    const [first, resent] = [await save(body), await save(body)];

    expect([first.status, resent.status]).toEqual([200, 200]);
    expect(resent.body.duplicated).toBe(true);
    expect(writes).toHaveLength(2);
    expect(logAction).toHaveBeenCalledTimes(1);
  });
});

describe("bidRoutes - /api/auction/close-and-cleanup", () => {
  beforeEach(() => {
    resetHandlersState();
  });

  it("checks out only the non-winners who are checked in and not already checked out - not winners, not un-checked-in bidders, not already-checked-out bidders", async () => {
    const version = changesSince(0).version;
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = url.pathname.split('/').pop() || "";
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "Name", "", "", "Checked In", "", "Checked Out"],
              ["1001", "Winner", "", "", "TRUE", "", "FALSE"],        // row 2: has a winning bid below - must be left alone
              ["1002", "Non-Winner", "", "", "TRUE", "", "FALSE"],    // row 3: no wins, checked in, not checked out - the only one that should get checked out
              ["1003", "Not-Checked-In", "", "", "FALSE", "", "FALSE"], // row 4: never checked in - must be left alone
              ["1004", "Already-Out", "", "", "TRUE", "", "TRUE"]     // row 5: already checked out - must be left alone
            ]
          });
        }
        if (range.includes("Bid-Management")) {
            return HttpResponse.json({
            values: [
              ["1001", "Price"],
              ["Total", ""],
              ["", ""],
              ["I01", "100"] // 1001's bidder-ID column (index 0) has a real win here - 1002/1003/1004 have no column at all, so they're non-winners by construction
            ]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );

    const response = await request(app)
      .post("/api/auction/close-and-cleanup")
      .set(authHeader)
      .send({
        spreadsheetId: "ss-id",
        bidderNumbersSheet: "Bidder-Numbers",
        bidManagementSheet: "Bid-Management"
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    // Exactly one bidder (1002) should have been queued for checkout.
    expect(response.body.count).toBe(1);

    const bidMgmtUpdates = valuesBatchUpdateRequests.filter(r => r.spreadsheetId === "ss-id");
    expect(bidMgmtUpdates).toHaveLength(1);
    expect(bidMgmtUpdates[0].data).toEqual([
      { range: "'Bidder-Numbers'!G3:H3", values: [[true, true]] }
    ]);
    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      area: "Bid Management",
      action: "Close auction",
      summary: "Closed the auction, checked out 1 bidder(s) who won nothing, and ended 0 volunteer(s)' access",
      notUndoableReason: expect.stringMatching(/\S/),
    }));
    expect(changesSince(version).changed).toContain("ss-id");
  });

  it("closes the auction with a count of 0 and issues no batch update when there is nothing to clean up", async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = url.pathname.split('/').pop() || "";
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "Name", "", "", "Checked In", "", "Checked Out"],
              ["1001", "Already-Out", "", "", "TRUE", "", "TRUE"]
            ]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );

    const response = await request(app)
      .post("/api/auction/close-and-cleanup")
      .set(authHeader)
      .send({
        spreadsheetId: "ss-id-empty",
        bidderNumbersSheet: "Bidder-Numbers",
        bidManagementSheet: "Bid-Management"
      });

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(0);
    expect(valuesBatchUpdateRequests.filter(r => r.spreadsheetId === "ss-id-empty")).toHaveLength(0);
  });

  it("returns 400 when no spreadsheet is given and the Config has none", async () => {
    const response = await request(app)
      .post("/api/auction/close-and-cleanup")
      .set(authHeader)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Missing required spreadsheet parameters");
  });
});

describe("bidRoutes - /api/auction/check-in-with-bid", () => {
  const validCheckInBody = {
    bidderId: "1001",
    spreadsheetId: "ss-id",
    bidManagementSheet: "Bid-Management",
    bidderNumbersSheet: "Bidder-Numbers",
    bidValue: 50,
    idempotencyKey: "checkin-unique-1"
  };

  // NOTE: POST /api/auction/check-in-with-bid is covered in the "Ticket Payment Status workflow" block.

  it("Auth failure — returns 401 when unauthenticated", async () => {
    const response = await request(app)
      .post("/api/auction/check-in-with-bid")
      .send({
        bidderId: "1001",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(401);
  });
});

describe("bidRoutes - /api/bidders/set-flag", () => {
  afterEach(() => {
    resetHandlersState();
  });

  it("ticks the bidder's Checked In box (column E) on their row", async () => {
    const response = await request(app)
      .post("/api/bidders/set-flag")
      .set(authHeader)
      .send({ spreadsheetId: "ss-id", bidderNumbersSheet: "Bidder-Numbers", bidderId: "42", flag: "checkedIn" });

    expect(response.status).toBe(200);
    expect(lastBulkWritePayload).toEqual([[true]]);
  });

  it("rejects a flag other than checkedIn/isProxy without writing", async () => {
    const response = await request(app)
      .post("/api/bidders/set-flag")
      .set(authHeader)
      .send({ spreadsheetId: "ss-id", bidderNumbersSheet: "Bidder-Numbers", bidderId: "42", flag: "paid" });

    expect(response.status).toBe(400);
    expect(updateCallCount).toBe(0);
  });

  it("returns 400 when the bidder isn't in the sheet", async () => {
    const response = await request(app)
      .post("/api/bidders/set-flag")
      .set(authHeader)
      .send({ spreadsheetId: "ss-id", bidderNumbersSheet: "Bidder-Numbers", bidderId: "999", flag: "isProxy" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not found/);
    expect(updateCallCount).toBe(0);
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await request(app)
      .post("/api/bidders/set-flag")
      .send({ spreadsheetId: "ss-id", bidderNumbersSheet: "Bidder-Numbers", bidderId: "42", flag: "checkedIn" });

    expect(response.status).toBe(401);
  });
});

describe('Checkout workflow', () => {
  afterEach(() => {
    resetHandlersState();
    server.resetHandlers();
  });

  // Since checkoutMarkPaid's credit_card branch now creates a PayPal
  // invoice on the fly when none exists yet (see
  // docs/agents/CHANGELOG.md's "PayPal Integration Issue" fix), any
  // credit_card test needs a Bid-Management grid that actually resolves
  // to a won item for bidder 42 - the shared default handler's
  // Bid-Management fallback (generic ["Header1","Header2"] rows) has no
  // "42" column and would make buildBidderReceipt fail with "Bidder ID
  // not found in matrix."
  const mockWonItemForBidder42 = () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        if (range.includes("Bid-Management")) {
          return HttpResponse.json({
            values: [
              ["42", "Price"],
              ["Total", ""],
              ["", ""],
              ["801", "150.00"]
            ]
          });
        }
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "First Name", "Last Name", "Email", "Phone", "Checked In", "Checked Out", "Is Paid", "Invoice URL", "Invoice Total Amount", "PayPal Fee Status", "Checkout Timestamp"],
              ["42", "John", "Doe", "john@example.com", "555-0199", "TRUE", "FALSE", "FALSE", "", "", "", ""]
            ]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );
  };

  it('Cash/Check payment — standard 200 path', async () => {
    const response = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send({
        bidderId: "42",
        spreadsheetId: "test-spreadsheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "cash",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.deferred).toBeFalsy();
  });

  it('Credit card payment — deferred 202 path', async () => {
    mockWonItemForBidder42();

    const response = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send({
        bidderId: "42",
        spreadsheetId: "test-spreadsheet-id",
        itemsSpreadsheetId: "test-items-spreadsheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "credit_card",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(202);
    expect(response.body.success).toBe(true);
    expect(response.body.deferred).toBe(true);
    expect(response.body.message).toBe("Verification deferred");
    expect(response.body.bidderId).toBe("42");
  });

  it('Idempotency — duplicate checkout submission', async () => {
    mockWonItemForBidder42();
    const key = crypto.randomUUID();
    const payload = {
      bidderId: "42",
      spreadsheetId: "test-spreadsheet-id",
      itemsSpreadsheetId: "test-items-spreadsheet-id",
      bidderNumbersSheet: "Bidder-Numbers",
      paymentMethod: "credit_card",
      idempotencyKey: key
    };

    const res1 = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send(payload);
    expect(res1.status).toBe(202);

    const res2 = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send(payload);

    // Same status as the original (a deferred checkout stays a 202), so a
    // retried request reads exactly like the first response did.
    expect(res2.status).toBe(202);
    expect(res2.body.duplicated).toBe(true);
    expect(res2.body.deferred).toBe(true);
    // 3 Bidder-Numbers writes must only have run once - the second,
    // duplicate submission is served entirely from the idempotency cache
    // without re-executing checkoutMarkPaid: the G:I checkbox/label
    // range, the L timestamp cell, and (new, since no invoice existed
    // for bidder 42 yet) the J:K invoice-URL/amount write that creating
    // a fresh PayPal invoice now makes.
    expect(updateCallCount).toBe(3);
  });

  it('Idempotency — a retry sent while the first checkout is still running does not run checkout again (ROADMAP.md H6)', async () => {
    mockWonItemForBidder42();
    const payload = {
      bidderId: "42",
      spreadsheetId: "test-spreadsheet-id",
      itemsSpreadsheetId: "test-items-spreadsheet-id",
      bidderNumbersSheet: "Bidder-Numbers",
      paymentMethod: "credit_card",
      idempotencyKey: crypto.randomUUID()
    };

    // Both requests in flight at once - the second arrives before the
    // first has finished, which the old check-then-save helpers missed.
    const [res1, res2] = await Promise.all([
      request(app).post("/api/auction/checkout-mark-paid").set(authHeader).send(payload),
      request(app).post("/api/auction/checkout-mark-paid").set(authHeader).send(payload),
    ]);

    expect([res1.status, res2.status]).toEqual([202, 202]);
    expect([res1.body.duplicated, res2.body.duplicated].filter(Boolean)).toHaveLength(1);
    // Same 3 writes as one checkout - not 6.
    expect(updateCallCount).toBe(3);
  });

  it('Auth failure', async () => {
    const response = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .send({
        bidderId: "42",
        spreadsheetId: "test-spreadsheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "cash",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(401);
  });

  it('Sheets API failure', async () => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', () => {
        return new HttpResponse(
          JSON.stringify({ error: { message: "Internal error", status: "INTERNAL" } }),
          { status: 500 }
        );
      })
    );

    const response = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send({
        bidderId: "42",
        spreadsheetId: "test-spreadsheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "cash",
        idempotencyKey: crypto.randomUUID()
      });

    expect(response.status).toBe(500);
    expect(response.body.success).toBeUndefined();
  });
});

describe('Full bid-to-checkout lifecycle', () => {
  const setupLifecycleMocks = (isCheckedOut = false) => {
    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "First Name", "Last Name", "Email", "Phone", "Checked In", "Checked Out", "Is Paid", "Invoice URL", "Invoice Total Amount", "PayPal Fee Status", "Checkout Timestamp"],
              ["42", "John", "Doe", "john@example.com", "555-0199", "TRUE", isCheckedOut ? "TRUE" : "FALSE", "FALSE", "", "", "", ""]
            ]
          });
        }
        if (range.includes("Bid-Management")) {
          return HttpResponse.json({
            values: [
              ["42", "Price"],
              ["Total", ""],
              ["", ""],
              // Item 801/$150 - matches the record-winning-bid call each
              // test in this describe block makes before checking out.
              // A real win here is required since checkoutMarkPaid's
              // credit_card branch now creates a PayPal invoice on the
              // fly when none exists, which needs buildBidderReceipt to
              // actually resolve a won item for bidder 42.
              ["801", "150.00"]
            ]
          });
        }
        return HttpResponse.json({ values: [] });
      })
    );
  };

  afterEach(() => {
    resetHandlersState();
    server.resetHandlers();
  });

  it('Happy path — bid recorded then cash checkout', async () => {
    setupLifecycleMocks(false);

    const bidRes = await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({
        bidderId: "42",
        itemId: "801",
        price: 150.00,
        spreadsheetId: "test-spreadsheet-id",
        bidManagementSheet: "Bid-Management",
        bidderNumbersSheet: "Bidder-Numbers",
        idempotencyKey: crypto.randomUUID()
      });

    expect(bidRes.status).toBe(200);
    expect(bidRes.body.success).toBe(true);

    const checkoutRes = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send({
        bidderId: "42",
        spreadsheetId: "test-spreadsheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "cash",
        idempotencyKey: crypto.randomUUID()
      });

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.success).toBe(true);
  });

  it('Happy path — bid recorded then credit card checkout', async () => {
    setupLifecycleMocks(false);

    const bidRes = await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({
        bidderId: "42",
        itemId: "801",
        price: 150.00,
        spreadsheetId: "test-spreadsheet-id",
        bidManagementSheet: "Bid-Management",
        bidderNumbersSheet: "Bidder-Numbers",
        idempotencyKey: crypto.randomUUID()
      });

    expect(bidRes.status).toBe(200);

    const checkoutRes = await request(app)
      .post("/api/auction/checkout-mark-paid")
      .set(authHeader)
      .send({
        bidderId: "42",
        spreadsheetId: "test-spreadsheet-id",
        itemsSpreadsheetId: "test-items-spreadsheet-id",
        bidderNumbersSheet: "Bidder-Numbers",
        paymentMethod: "credit_card",
        idempotencyKey: crypto.randomUUID()
      });

    expect(checkoutRes.status).toBe(202);
    expect(checkoutRes.body.message).toBe("Verification deferred");
  });

  it('Lifecycle — checked-out bidder winning bid goes to follow-up', async () => {
    const capturedRequests: { method: string; range: string; body?: any }[] = [];

    server.use(
      http.get('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range', ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/').pop() || "");
        
        if (range.includes("Bidder-Numbers")) {
          return HttpResponse.json({
            values: [
              ["ID", "First Name", "Last Name", "Email", "Phone", "Checked In", "Checked Out", "Is Paid", "Invoice URL", "Invoice Total Amount", "PayPal Fee Status", "Checkout Timestamp"],
              ["42", "John", "Doe", "john@example.com", "555-0199", "TRUE", "TRUE", "FALSE", "", "", "", ""]
            ]
          });
        }
        if (range.includes("Bid-Management")) {
          return HttpResponse.json({
            values: [
              ["42", "Price"],
              ["Total", ""],
              ["", ""],
              ["", ""]
            ]
          });
        }
        return HttpResponse.json({ values: [] });
      }),

      http.put('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/*', async ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/values/')[1] || "");
        const body = await request.clone().json().catch(() => null);
        capturedRequests.push({ method: 'PUT', range, body });
        return HttpResponse.json({ updatedRows: 1 });
      }),

      http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/*', async ({ request }) => {
        const url = new URL(request.url);
        const range = decodeURIComponent(url.pathname.split('/values/')[1] || "");
        const body = await request.clone().json().catch(() => null);
        capturedRequests.push({ method: 'POST', range, body });
        return HttpResponse.json({ updates: { updatedRange: "Follow-Up!A2:C2", updatedRows: 1 } });
      }),

      http.post('https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId\\:batchUpdate', () => {
        return HttpResponse.json({ replies: [] });
      })
    );

    const bidRes = await request(app)
      .post("/api/auction/record-winning-bid")
      .set(authHeader)
      .send({
        bidderId: "42",
        itemId: "801",
        price: 150.00,
        spreadsheetId: "test-spreadsheet-id",
        bidManagementSheet: "Bid-Management",
        bidderNumbersSheet: "Bidder-Numbers",
        idempotencyKey: crypto.randomUUID()
      });

    expect(bidRes.status).toBe(200);
    expect(bidRes.body.success).toBe(true);

    const appends = capturedRequests.filter(r => r.method === 'POST' && r.range.includes('append'));
    expect(appends.length).toBeGreaterThan(0);
    
    const hasFollowUpWrite = appends.some(r => r.range.includes('Follow-Up'));
    expect(hasFollowUpWrite).toBe(true);

    const hasBidManagementAppend = appends.some(r => r.range.includes('Bid-Management'));
    expect(hasBidManagementAppend).toBe(false);
  });
});