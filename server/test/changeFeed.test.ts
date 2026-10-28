import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../app";
import { authCookieHeader } from "./helpers/session";
import { announce, changesSince, noteChange, _resetChangeFeedForTesting } from "../utils/changeFeed";
import { clearCacheForSpreadsheet } from "../utils/sheetCache";

const admin = authCookieHeader({ access_token: "t", refresh_token: "r", expiry_date: Date.now() + 3600000 });

beforeEach(() => _resetChangeFeedForTesting());

describe("changeFeed", () => {
  it("reports each key changed after the version a browser last saw", () => {
    noteChange("bm");
    const seen = changesSince(0).version;
    noteChange("it");
    noteChange("bm");

    expect(changesSince(seen)).toEqual({ version: 3, changed: expect.arrayContaining(["it", "bm"]), notices: [], reset: false });
    expect(changesSince(3).changed).toEqual([]);
  });

  it("hands each browser only the notices made since it last looked", () => {
    announce("dan@orns.org undid an action: Checked in bidder 104.", "dan@orns.org", "Bid Management");
    const seen = changesSince(0).version;
    announce("dan@orns.org undid an action: Recorded a bid.", "dan@orns.org", "Bid Management");

    expect(changesSince(0).notices).toHaveLength(2);
    expect(changesSince(seen).notices).toEqual([{ version: 2, message: "dan@orns.org undid an action: Recorded a bid.", by: "dan@orns.org", area: "Bid Management" }]);
  });

  it("every server write is recorded, through the cache clear that follows it", () => {
    clearCacheForSpreadsheet("tickets-sheet");
    expect(changesSince(0).changed).toEqual(["tickets-sheet"]);
  });

  it("says reset when the browser's version is ahead of the server's (the server restarted)", () => {
    expect(changesSince(50)).toEqual({ version: 0, changed: [], notices: [], reset: true });
  });

  it("GET /api/changes answers signed-in browsers from memory", async () => {
    noteChange("bm");
    const res = await request(app).get("/api/changes?since=0").set(admin);
    expect(res.body).toEqual({ version: 1, changed: ["bm"], notices: [], reset: false });
    expect((await request(app).get("/api/changes")).status).toBe(401);
  });
});
