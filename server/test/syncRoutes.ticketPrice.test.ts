/**
 * Set Up Bid Management App takes the ticket price from the website
 * (ticketPriceFromWebsite.ts, tested on its own) - here, what the route
 * does with the answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../services/ticketPoll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ticketPoll")>()),
  pollTicketPurchasesFirst: vi.fn(),
}));
vi.mock("../services/ticketPriceFromWebsite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ticketPriceFromWebsite")>()),
  syncTicketPriceFromWebsite: vi.fn(),
}));
vi.mock("../services/syncService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/syncService")>()),
  performSheetSync: vi.fn(),
}));

import { app } from "../app";
import { authCookieHeader } from "./helpers/session";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { logAction } from "../services/actionLog";
import { pollTicketPurchasesFirst } from "../services/ticketPoll";
import { syncTicketPriceFromWebsite } from "../services/ticketPriceFromWebsite";
import { performSheetSync } from "../services/syncService";
import { changesSince } from "../utils/changeFeed";

const admin = authCookieHeader({ access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 });

beforeEach(async () => {
  vi.mocked(logAction).mockClear();
  vi.mocked(pollTicketPurchasesFirst).mockReset();
  vi.mocked(performSheetSync).mockReset().mockResolvedValue({ bidders: 12 } as any);
  vi.mocked(syncTicketPriceFromWebsite).mockReset();
  await getAdminFirestore().collection("settings").doc("global").set({ bidManagementSpreadsheetId: "bm", auctionTicketsSpreadsheetId: "tk" });
});

const setUp = () => request(app).post("/api/bidders/sync").set(admin).send({});

describe("Set Up Bid Management App - the ticket price from the website", () => {
  it("checks the price after the website purchases, before rebuilding, and records a change in Action History", async () => {
    const order: string[] = [];
    vi.mocked(pollTicketPurchasesFirst).mockImplementation(async () => { order.push("poll"); });
    vi.mocked(syncTicketPriceFromWebsite).mockImplementation(async () => { order.push("price"); return { outcome: "updated", price: "35", previous: "30" }; });
    vi.mocked(performSheetSync).mockImplementation(async () => { order.push("rebuild"); return {} as any; });
    const before = changesSince(0).version;

    const res = await setUp();

    expect(res.status).toBe(200);
    expect(order).toEqual(["poll", "price", "rebuild"]);
    expect(syncTicketPriceFromWebsite).toHaveBeenCalledWith("test-admin@orns.org");
    expect(res.body.ticketPrice).toEqual({ outcome: "updated", price: "35", previous: "30", message: "Ticket price changed from $30 to $35 to match the website." });
    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      area: "Settings", action: "Update ticket price from website", before: { ticketPrice: "30" }, after: { ticketPrice: "35" },
    }));
    expect(changesSince(before).changed).toContain("config");
  });

  it("records the price change even when the rebuild then fails", async () => {
    vi.mocked(syncTicketPriceFromWebsite).mockResolvedValue({ outcome: "updated", price: "35", previous: "30" });
    vi.mocked(performSheetSync).mockRejectedValue(new Error("Missing 'Bidder-Numbers'"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await setUp()).status).toBe(400);
    expect(logAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "Update ticket price from website" }));
    vi.mocked(console.error).mockRestore();
  });

  it("goes on with Set Up when the price can't be checked, and says why", async () => {
    vi.mocked(syncTicketPriceFromWebsite).mockResolvedValue({ outcome: "no-purchases" });

    const res = await setUp();

    expect(res.status).toBe(200);
    expect(performSheetSync).toHaveBeenCalledWith(expect.anything(), "bm", "tk");
    expect(res.body.ticketPrice.message).toContain("No website ticket purchases yet");
    expect(logAction).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "Update ticket price from website" }));
  });
});
