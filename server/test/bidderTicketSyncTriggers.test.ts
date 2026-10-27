import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { app } from "../app";
import { authCookieHeader } from "./helpers/session";
import { syncBiddersFromTickets } from "../services/bidderTicketSync";

const admin = authCookieHeader({ access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 });
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

/** Bidders follow their tickets: every path that changes a ticket or uses bidder names runs the sync first. */
describe("when bidders are brought in line with their tickets", () => {
  beforeEach(() => vi.mocked(syncBiddersFromTickets).mockClear());

  it("after an attendee edit", async () => {
    server.use(
      http.get(`${SHEETS}/:id/values/:range`, () => HttpResponse.json({ values: [["Amy/Chris"]] })),
      http.put(`${SHEETS}/:id/values/:range`, () => HttpResponse.json({}))
    );
    const res = await request(app).post("/api/attendees/update").set(admin).send({ spreadsheetId: "tk", range: "tickets!A4", values: [["Amy & Chris"]] });
    expect(res.status).toBe(200);
    expect(syncBiddersFromTickets).toHaveBeenCalledTimes(1);
  });

  it("when the Bid Management page asks, answering what changed and who is still untied", async () => {
    vi.mocked(syncBiddersFromTickets).mockResolvedValueOnce({ renamed: [{ id: "101" } as any], added: [], unlinked: ["117"] });
    const res = await request(app).post("/api/bidders/sync-from-tickets").set(admin).send({});
    expect(res.body).toEqual({ renamed: 1, added: 0, unlinked: ["117"] });
  });

  it("in the background, from staff screens' change-feed checks", async () => {
    await request(app).get("/api/changes?since=0").set(admin);
    expect(syncBiddersFromTickets).toHaveBeenCalledWith(expect.anything(), { background: true });
  });

  it("before any receipt route", async () => {
    await request(app).post("/api/receipts/email-only").set(admin).send({});
    expect(syncBiddersFromTickets).toHaveBeenCalledTimes(1);
  });
});
