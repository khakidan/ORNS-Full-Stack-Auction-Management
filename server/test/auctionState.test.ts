import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { http, HttpResponse } from "msw";
import { app } from "../app";
import { server } from "./setup";
import { authCookieHeader } from "./helpers/session";
import { parseAuctionState } from "../utils/auctionState";
import { goLiveAuction, AuctionStateError } from "../services/auctionService";

describe("parseAuctionState", () => {
  it("reads the three words, ignoring case and spacing", () => {
    expect(parseAuctionState("Prep")).toBe("prep");
    expect(parseAuctionState(" live ")).toBe("live");
    expect(parseAuctionState("CLOSED")).toBe("closed");
  });

  it("reads a sheet from before the three states: the old TRUE is Prep and FALSE is Closed", () => {
    expect(parseAuctionState(true)).toBe("prep");
    expect(parseAuctionState("TRUE")).toBe("prep");
    expect(parseAuctionState(false)).toBe("closed");
    expect(parseAuctionState("FALSE")).toBe("closed");
  });

  it("treats a blank or unrecognized cell as Prep rather than Closed", () => {
    expect(parseAuctionState(undefined)).toBe("prep");
    expect(parseAuctionState("")).toBe("prep");
    expect(parseAuctionState("whatever")).toBe("prep");
  });
});

function fakeSheets(cell: unknown) {
  const update = vi.fn(async () => ({}));
  const get = vi.fn(async () => ({ data: { values: cell === undefined ? undefined : [[cell]] } }));
  return { sheets: { spreadsheets: { values: { get, update } } } as any, update };
}

describe("goLiveAuction", () => {
  it.each([[true], ["Prep"], [undefined]])("writes Live when the cell is %s (Prep)", async (cell) => {
    const { sheets, update } = fakeSheets(cell);

    await expect(goLiveAuction(sheets, { spreadsheetId: "s" })).resolves.toEqual({ state: "live" });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ range: "'Auction-Status'!A2", requestBody: { values: [["Live"]] } }));
  });

  it.each([["Live"], ["Closed"], [false]])("refuses, and writes nothing, when the cell is %s - the states only move forward", async (cell) => {
    const { sheets, update } = fakeSheets(cell);

    await expect(goLiveAuction(sheets, { spreadsheetId: "s" })).rejects.toBeInstanceOf(AuctionStateError);

    expect(update).not.toHaveBeenCalled();
  });
});

describe("POST /api/auction/go-live", () => {
  const auth = authCookieHeader({ access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 });

  it("answers 400 without a spreadsheet ID", async () => {
    const res = await request(app).post("/api/auction/go-live").set(auth).send({});
    expect(res.status).toBe(400);
  });

  it("answers 409 when the auction is already Closed", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:id/values/:range", () => HttpResponse.json({ values: [["Closed"]] }))
    );

    const res = await request(app).post("/api/auction/go-live").set(auth).send({ spreadsheetId: "ss-closed" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already Closed");
  });
});

describe("isBidManagementSetUp", () => {
  const sheetsWith = (...titles: string[]) =>
    ({ spreadsheets: { get: vi.fn(async () => ({ data: { sheets: titles.map((title) => ({ properties: { title } })) } })) } }) as any;

  it("is true once the Bid-Management grid tab exists", async () => {
    const { isBidManagementSetUp } = await import("../services/syncService");
    expect(await isBidManagementSetUp(sheetsWith("Bidder-Numbers", "Bid-Management"), "s")).toBe(true);
  });

  it("is false with only Bidder-Numbers, which printing bidder labels builds before the real setup", async () => {
    const { isBidManagementSetUp } = await import("../services/syncService");
    expect(await isBidManagementSetUp(sheetsWith("Bidder-Numbers", "Auction-Status"), "s")).toBe(false);
  });
});

describe("GET /api/bidders/setup-status", () => {
  const auth = authCookieHeader({ access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 });

  it("answers 400 without a spreadsheet ID and 401 without a session", async () => {
    expect((await request(app).get("/api/bidders/setup-status").set(auth)).status).toBe(400);
    expect((await request(app).get("/api/bidders/setup-status?spreadsheetId=x")).status).toBe(401);
  });

  it("reports setUp from the spreadsheet's tabs", async () => {
    server.use(
      http.get("https://sheets.googleapis.com/v4/spreadsheets/:id", () =>
        HttpResponse.json({ sheets: [{ properties: { title: "Bid-Management" } }] }))
    );

    const res = await request(app).get("/api/bidders/setup-status?spreadsheetId=ss").set(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ setUp: true });
  });
});
