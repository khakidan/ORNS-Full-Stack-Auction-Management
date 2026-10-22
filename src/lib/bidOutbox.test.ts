/**
 * @vitest-environment jsdom
 *
 * The saved-bids outbox (Milestone A): winning bids that couldn't reach
 * the server, kept in localStorage and sent later with their original
 * idempotency key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn(),
  getBaseUrl: () => "",
}));

import { fetchWithRetry } from "@/services/google-api";
import {
  addToOutbox, flushOutbox, getOutboxState, onOutboxSettled, OUTBOX_STORAGE_KEY,
  removeFromOutbox, retryOutboxEntry, RecordWinningBidBody,
  _reloadOutboxForTesting, _resetOutboxForTesting,
} from "./bidOutbox";

const fetchMock = vi.mocked(fetchWithRetry);

function bid(n: number, overrides: Partial<RecordWinningBidBody> = {}): RecordWinningBidBody {
  return {
    bidderId: String(100 + n), itemId: String(1300 + n), price: 50 + n, spreadsheetId: "ss",
    bidManagementSheet: "Bid-Management", bidderNumbersSheet: "Bidder-Numbers", idempotencyKey: `key-${n}`, ...overrides,
  };
}
const display = { bidderName: "Maria Lopez", itemName: "Cabin Weekend" };
const ok = (data: object = { success: true }) => ({ ok: true, status: 200, json: async () => data }) as Response;
const status = (code: number, data: object = {}) => ({ ok: false, status: code, json: async () => data }) as Response;

describe("bidOutbox", () => {
  beforeEach(() => {
    _resetOutboxForTesting();
    fetchMock.mockReset();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps a bid in localStorage, so a reload doesn't lose it", () => {
    expect(addToOutbox(bid(1), display)).toBe(true);
    expect(JSON.parse(localStorage.getItem(OUTBOX_STORAGE_KEY)!)[0].body.idempotencyKey).toBe("key-1");
    expect(getOutboxState().entries[0]).toMatchObject({ status: "waiting", bidderName: "Maria Lopez" });
  });

  it("ignores a second add of the same bid", () => {
    addToOutbox(bid(1), display);
    addToOutbox(bid(1), display);
    expect(getOutboxState().entries).toHaveLength(1);
  });

  it("treats a bid left mid-send by a closed tab as waiting again", () => {
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify([{ body: bid(1), ...display, createdAt: 1, attempts: 0, status: "sending" }]));
    _reloadOutboxForTesting();
    expect(getOutboxState().entries[0].status).toBe("waiting");
  });

  it("sends oldest first with the original body and key, removes each sent bid, and reports them", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(2000).mockReturnValueOnce(1000);
    addToOutbox(bid(2), display); // newer
    addToOutbox(bid(1), display); // older
    vi.mocked(Date.now).mockRestore();
    fetchMock.mockResolvedValue(ok({ success: true, followUpAdded: true }));
    const settled = vi.fn();
    const off = onOutboxSettled(settled);

    await flushOutbox();
    off();

    expect(fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]!.body)).idempotencyKey)).toEqual(["key-1", "key-2"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual(bid(1));
    expect(getOutboxState().entries).toEqual([]);
    expect(getOutboxState().lastSentAt).not.toBeNull();
    expect(settled.mock.calls[0][0].map((s: any) => s.response.followUpAdded)).toEqual([true, true]);
  });

  it("stops at the first bid that still can't get through, keeping it and everything after it", async () => {
    addToOutbox(bid(1), display);
    addToOutbox(bid(2), display);
    fetchMock.mockRejectedValueOnce(new Error("Failed to fetch"));

    await flushOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getOutboxState().entries.map((e) => [e.body.idempotencyKey, e.status, e.attempts])).toEqual([["key-1", "waiting", 1], ["key-2", "waiting", 0]]);
  });

  it("moves a bid the server refuses to needsReview with its reason, and carries on with the rest", async () => {
    addToOutbox(bid(1), display);
    addToOutbox(bid(2), display);
    fetchMock.mockResolvedValueOnce(status(409, { error: "Item #1301 already has a winning bid" })).mockResolvedValueOnce(ok());

    await flushOutbox();

    expect(getOutboxState().entries).toEqual([expect.objectContaining({ status: "needsReview", problem: "Item #1301 already has a winning bid" })]);
  });

  it("pauses on an expired sign-in (401), keeping the bid waiting", async () => {
    addToOutbox(bid(1), display);
    addToOutbox(bid(2), display);
    fetchMock.mockResolvedValueOnce(status(401));

    await flushOutbox();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getOutboxState().needsSignIn).toBe(true);
    expect(getOutboxState().entries.every((e) => e.status === "waiting")).toBe(true);
  });

  it("doesn't try while the browser is offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    addToOutbox(bid(1), display);
    await flushOutbox();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("joins a send already in progress instead of starting a second", async () => {
    addToOutbox(bid(1), display);
    let release!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise((r) => { release = r; }));

    const a = flushOutbox();
    const b = flushOutbox();
    await vi.waitFor(() => expect(getOutboxState().sending).toEqual({ sent: 0, total: 1 }));
    release(ok());
    await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getOutboxState().sending).toBeNull();
  });

  it("lets staff retry or remove a bid that needs review", async () => {
    addToOutbox(bid(1), display);
    addToOutbox(bid(2), display);
    fetchMock.mockResolvedValue(status(409, { error: "taken" }));
    await flushOutbox();

    fetchMock.mockResolvedValue(ok());
    await retryOutboxEntry("key-1");
    removeFromOutbox("key-2");

    expect(getOutboxState().entries).toEqual([]);
  });

  it("keeps bids in memory when this browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(addToOutbox(bid(1), display)).toBe(false);
    fetchMock.mockRejectedValue(new Error("Failed to fetch"));

    await flushOutbox();

    expect(getOutboxState().entries).toHaveLength(1);
  });
});
