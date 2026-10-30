import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeFirestore } from "./helpers/fakeFirestore";

/** The real Firestore-backed store (setup.ts mocks it for every other test). */
const fake = createFakeFirestore();
vi.mock("../services/firebaseAdmin", () => ({ getAdminFirestore: () => fake.db }));

const store = await vi.importActual<typeof import("../services/actionHistoryStore")>("../services/actionHistoryStore");
const doc = () => fake.docs("system").get("actionHistory");

beforeEach(() => {
  fake.clear();
  store._resetActionHistoryStoreForTesting();
});

describe("the Action History spreadsheet ID", () => {
  it("is read once and then cached for 30 seconds", async () => {
    fake.docs("system").set("actionHistory", { spreadsheetId: " ah-1 " });
    const get = vi.spyOn(fake.db, "collection");

    expect(await store.getActionHistorySpreadsheetId(1_000)).toBe("ah-1");
    fake.docs("system").set("actionHistory", { spreadsheetId: "ah-2" });
    expect(await store.getActionHistorySpreadsheetId(30_999)).toBe("ah-1");
    expect(get).toHaveBeenCalledTimes(1);

    expect(await store.getActionHistorySpreadsheetId(31_000)).toBe("ah-2");
    expect(get).toHaveBeenCalledTimes(2);
    get.mockRestore();
  });

  it("is \"\" before the spreadsheet is created", async () => {
    expect(await store.getActionHistorySpreadsheetId()).toBe("");
  });

  it("falls back to the cached ID when Firestore can't be read, or \"\" with nothing cached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = () => vi.spyOn(fake.db, "collection").mockImplementationOnce(() => { throw new Error("Firestore is down"); });

    down();
    expect(await store.getActionHistorySpreadsheetId(0)).toBe("");

    fake.docs("system").set("actionHistory", { spreadsheetId: "ah-1" });
    expect(await store.getActionHistorySpreadsheetId(0)).toBe("ah-1");
    down();
    expect(await store.getActionHistorySpreadsheetId(60_000)).toBe("ah-1");
    warn.mockRestore();
  });

  it("is cached as soon as it's set, so the next action goes to the new spreadsheet", async () => {
    await store.setActionHistorySpreadsheetId("ah-new", "jane@orns.org");

    expect(doc()).toMatchObject({ spreadsheetId: "ah-new", createdBy: "jane@orns.org" });
    fake.clear();
    expect(await store.getActionHistorySpreadsheetId()).toBe("ah-new");
  });

  it("creating the spreadsheet keeps the record of who turned edit tracking on (ROADMAP A11)", async () => {
    await store.setEditTrackingRecord({ by: "sam@orns.org", at: "2027-03-01T15:00:00.000Z" });

    await store.setActionHistorySpreadsheetId("ah-new", "jane@orns.org");

    expect(await store.getEditTrackingRecord()).toEqual({ by: "sam@orns.org", at: "2027-03-01T15:00:00.000Z" });
    expect(doc()).toMatchObject({ spreadsheetId: "ah-new" });
  });
});

describe("edit tracking's owner", () => {
  it("round-trips, keeps the spreadsheet ID, and reads null once turned off", async () => {
    await store.setActionHistorySpreadsheetId("ah-1", "jane@orns.org");
    await store.setEditTrackingRecord({ by: "sam@orns.org", at: "2027-03-01T15:00:00.000Z" });
    expect(await store.getEditTrackingRecord()).toEqual({ by: "sam@orns.org", at: "2027-03-01T15:00:00.000Z" });
    expect(doc()?.spreadsheetId).toBe("ah-1");

    await store.setEditTrackingRecord(null);
    expect(await store.getEditTrackingRecord()).toBeNull();
  });
});

describe("the undo guard (ROADMAP A1)", () => {
  it("remembers an undone action, even one whose ID contains '/'", async () => {
    const id = "2027-03-01T15:00:00.000Z/jane@orns.org/Set special winner";
    expect(await store.wasUndone(id)).toBe(false);

    await store.recordUndone(id, "sam@orns.org");

    expect(await store.wasUndone(id)).toBe(true);
    expect(await store.wasUndone("2027-03-01T15:00:00.000Z/jane@orns.org")).toBe(false);
    expect(fake.docs("undoneActions").get(encodeURIComponent(id))).toMatchObject({ undoneBy: "sam@orns.org" });
  });
});
