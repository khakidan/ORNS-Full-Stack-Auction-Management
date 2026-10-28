/**
 * POST /api/tickets/fluent-forms/check-now - the poll on demand (ROADMAP W5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockPoll = vi.fn();
vi.mock("../services/ticketPoll", () => ({
  pollTicketPurchasesNow: (...args: unknown[]) => mockPoll(...args),
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
