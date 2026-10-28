/**
 * POST /api/tickets/fluent-forms/check-now - the poll on demand (ROADMAP W5) -
 * and GET /api/tickets/fluent-forms/status, the Tickets page's status card (W6).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockPoll = vi.fn();
const mockPollStatus = vi.fn();
vi.mock("../services/ticketPoll", () => ({
  pollTicketPurchasesNow: (...args: unknown[]) => mockPoll(...args),
  readTicketPollStatus: () => mockPollStatus(),
  pollTicketPurchasesFirst: vi.fn(),
  startNewTicketSeason: vi.fn(),
}));

import { app } from "../app";
import { authCookieHeader } from "./helpers/session";
import { logAction } from "../services/actionLog";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { AlreadyRunningError } from "../utils/asyncLock";

const URL = "/api/tickets/fluent-forms/check-now";
const tokens = { access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 };
const run = (overrides = {}) => ({ added: [], wouldAdd: [], paymentsSet: [], errors: [], ...overrides });

beforeEach(() => {
  mockPoll.mockReset().mockResolvedValue(run());
  mockPollStatus.mockReset().mockResolvedValue(null);
});

describe("POST /api/tickets/fluent-forms/check-now", () => {
  it("runs the poll for staff, naming who asked", async () => {
    const res = await request(app).post(URL).set(authCookieHeader(tokens));
    expect(res.status).toBe(200);
    expect(mockPoll).toHaveBeenCalledWith("staff: test-admin@orns.org");
  });

  it("records in Action History who ran a check that changed something", async () => {
    mockPoll.mockResolvedValue(run({ added: ["1483"], paymentsSet: ["1481"] }));
    await request(app).post(URL).set(authCookieHeader(tokens));
    expect(vi.mocked(logAction)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      area: "Tickets", action: "Check website ticket purchases", summary: expect.stringContaining("added 1 missed purchase(s), confirmed 1 payment(s)"),
    }));
  });

  it("doesn't fill Action History with checks that found nothing", async () => {
    await request(app).post(URL).set(authCookieHeader(tokens));
    expect(vi.mocked(logAction)).not.toHaveBeenCalled();
  });

  it("is for staff who can run the auction's stages - not every signed-in user", async () => {
    await getAdminFirestore().collection("userRoles").doc("helper@orns.org").set({ role: "user" });
    const res = await request(app).post(URL).set(authCookieHeader(tokens, "helper@orns.org"));
    expect(res.status).toBe(403);
    expect(mockPoll).not.toHaveBeenCalled();
  });

  it("answers 409 while a run is going, and 503 until the Fluent Forms API is set up", async () => {
    mockPoll.mockRejectedValueOnce(new AlreadyRunningError());
    expect((await request(app).post(URL).set(authCookieHeader(tokens))).status).toBe(409);
    mockPoll.mockResolvedValueOnce(null);
    expect((await request(app).post(URL).set(authCookieHeader(tokens))).status).toBe(503);
  });
});

describe("GET /api/tickets/fluent-forms/status", () => {
  const STATUS = "/api/tickets/fluent-forms/status";

  it("before anything has happened: no webhook, no poll, nothing to review", async () => {
    const res = await request(app).get(STATUS).set(authCookieHeader(tokens));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "compare", lastWebhook: null, poll: null, missed: [], submittedAt: {}, review: [] });
  });

  it("gathers the last webhook, the poll's runs, the missed entries and the review list", async () => {
    const db = getAdminFirestore();
    await db.collection("system").doc("fluentFormsTickets").set({ lastWebhook: { at: "2027-02-01T16:00:00.000Z", entryId: "1490", outcome: "error", error: "Sheets said no", read: { tickets: 2 } } });
    await db.collection("ticketPurchaseReview").doc("1491").set({ entryId: "1491", name: "Pat Lee", problems: ["4 guests for 2 tickets"], firstSeenAt: "2027-02-02T00:00:00.000Z", lastSeenAt: "2027-02-02T00:00:00.000Z" });
    await db.collection("ticketPurchaseReview").doc("1489").set({ entryId: "1489", name: "Sam Roe", problems: ["PayPal has no payment X"], firstSeenAt: "2027-02-01T00:00:00.000Z", lastSeenAt: "2027-02-03T00:00:00.000Z" });
    mockPollStatus.mockResolvedValue({
      seasonStartEntryId: 1482, highWaterEntryId: 1491, settled: {}, lastSuccessAt: "2027-02-03T11:00:00.000Z",
      missed: { "1488": "2027-02-02T11:00:00.000Z", "1485": "2027-02-01T11:00:00.000Z" }, submittedAt: { "1485": "2027-01-30 10:00:00" },
      lastRun: { at: "2027-02-03T16:00:00.000Z", errors: ["WordPress said no"] },
    });

    const res = await request(app).get(STATUS).set(authCookieHeader(tokens));

    expect(res.body).toEqual({
      configured: expect.any(Boolean),
      mode: "compare",
      lastWebhook: { at: "2027-02-01T16:00:00.000Z", entryId: "1490", outcome: "error", error: "Sheets said no" },
      poll: { lastSuccessAt: "2027-02-03T11:00:00.000Z", lastRunAt: "2027-02-03T16:00:00.000Z", lastRunErrors: ["WordPress said no"], seasonStartEntryId: 1482 },
      missed: [{ entryId: "1485", at: "2027-02-01T11:00:00.000Z" }, { entryId: "1488", at: "2027-02-02T11:00:00.000Z" }],
      submittedAt: { "1485": "2027-01-30 10:00:00" },
      review: [expect.objectContaining({ entryId: "1489", name: "Sam Roe" }), expect.objectContaining({ entryId: "1491", name: "Pat Lee" })],
    });
  });

  it("is for staff who can run the auction's stages", async () => {
    await getAdminFirestore().collection("userRoles").doc("helper@orns.org").set({ role: "user" });
    const res = await request(app).get(STATUS).set(authCookieHeader(tokens, "helper@orns.org"));
    expect(res.status).toBe(403);
  });
});
