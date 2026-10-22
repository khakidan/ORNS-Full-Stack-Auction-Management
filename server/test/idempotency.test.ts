import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * server/utils/idempotency.ts's withIdempotency. The "in-flight" and
 * "scope" tests are the regression guards for ROADMAP.md H6: the old
 * check-then-save helpers only recorded a key once its request had
 * finished, so a retry arriving mid-request ran the whole action again,
 * and keys were shared across every route.
 */
describe("withIdempotency", () => {
  let withIdempotency: typeof import("../utils/idempotency").withIdempotency;
  let idempotentBody: typeof import("../utils/idempotency").idempotentBody;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Fresh module per test, so its cleanup setInterval is registered
    // against these fake timers and no keys leak between tests.
    vi.resetModules();
    const mod = await import("../utils/idempotency");
    withIdempotency = mod.withIdempotency;
    idempotentBody = mod.idempotentBody;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the action once and returns the cached result for a repeated key", async () => {
    const fn = vi.fn().mockResolvedValue({ success: true, bidId: 442 });

    const first = await withIdempotency("route", "key-1", fn);
    const second = await withIdempotency("route", "key-1", fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ result: { success: true, bidId: 442 }, duplicated: false });
    expect(second).toEqual({ result: { success: true, bidId: 442 }, duplicated: true });
  });

  it("makes a retry that arrives while the first request is still running wait for it instead of running the action again", async () => {
    let finish!: (value: { success: boolean }) => void;
    const fn = vi.fn(() => new Promise<{ success: boolean }>((resolve) => { finish = resolve; }));

    const first = withIdempotency("route", "key-2", fn);
    const retry = withIdempotency("route", "key-2", fn);
    finish({ success: true });

    expect(await first).toEqual({ result: { success: true }, duplicated: false });
    expect(await retry).toEqual({ result: { success: true }, duplicated: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure - requests waiting on it fail too, and a later retry runs the action again", async () => {
    let fail!: (error: Error) => void;
    const fn = vi.fn()
      .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }))
      .mockResolvedValueOnce({ success: true });

    const first = withIdempotency("route", "key-3", fn);
    const waiting = withIdempotency("route", "key-3", fn);
    fail(new Error("Sheets write failed"));

    await expect(first).rejects.toThrow("Sheets write failed");
    await expect(waiting).rejects.toThrow("Sheets write failed");

    const later = await withIdempotency("route", "key-3", fn);
    expect(later).toEqual({ result: { success: true }, duplicated: false });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps the same key on two different routes separate", async () => {
    const restore = vi.fn().mockResolvedValue({ action: "restore" });
    const processBundle = vi.fn().mockResolvedValue({ action: "process" });

    await withIdempotency("bundle/restore", "shared-key", restore);
    const other = await withIdempotency("bundle/process", "shared-key", processBundle);

    expect(processBundle).toHaveBeenCalledTimes(1);
    expect(other).toEqual({ result: { action: "process" }, duplicated: false });
  });

  it("runs the action every time when no usable key is given", async () => {
    const fn = vi.fn().mockResolvedValue({ success: true });

    await withIdempotency("route", undefined, fn);
    await withIdempotency("route", "", fn);
    await withIdempotency("route", 123, fn);

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("expires a completed key after the 1-hour TTL", async () => {
    const fn = vi.fn().mockResolvedValue({ balance: 95 });
    await withIdempotency("route", "ttl-key", fn);

    // 40 minutes in (cleanup runs every 10): still cached.
    vi.advanceTimersByTime(40 * 60 * 1000);
    expect((await withIdempotency("route", "ttl-key", fn)).duplicated).toBe(true);

    // Past the hour plus one cleanup tick: purged, so the action runs again.
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect((await withIdempotency("route", "ttl-key", fn)).duplicated).toBe(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("idempotentBody flags reused results with duplicated: true and leaves fresh ones unchanged", () => {
    expect(idempotentBody({ result: { success: true }, duplicated: false })).toEqual({ success: true });
    expect(idempotentBody({ result: { success: true }, duplicated: true })).toEqual({ success: true, duplicated: true });
  });
});

/**
 * `durable: true` (Milestone A): a winning bid saved on a device while
 * offline can be resent hours later, after Cloud Run has restarted and the
 * in-memory map is empty. setup.ts swaps the Firestore store for an
 * in-memory stand-in.
 */
describe("withIdempotency - durable", () => {
  let mod: typeof import("../utils/idempotency");
  let store: typeof import("../services/idempotencyStore");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("../utils/idempotency");
    store = await import("../services/idempotencyStore");
    vi.mocked(store.getStoredResult).mockClear();
    vi.mocked(store.storeResult).mockClear();
  });

  it("returns the first result after the in-memory map is lost, without running again", async () => {
    const fn = vi.fn().mockResolvedValue({ success: true });
    await mod.withIdempotency("auction/record-winning-bid", "k1", fn, { durable: true });

    mod._resetIdempotencyForTesting(); // a restart

    const again = await mod.withIdempotency("auction/record-winning-bid", "k1", fn, { durable: true });
    expect(again).toEqual({ result: { success: true }, duplicated: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("still runs once when two copies arrive together", async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<{ ok: true }>((r) => { release = () => r({ ok: true }); }));

    const a = mod.withIdempotency("s", "k2", fn, { durable: true });
    const b = mod.withIdempotency("s", "k2", fn, { durable: true });
    await vi.waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    release();

    expect((await a).duplicated).toBe(false);
    expect((await b).duplicated).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory alone when Firestore can't be read or written", async () => {
    vi.mocked(store.getStoredResult).mockRejectedValueOnce(new Error("UNAVAILABLE"));
    vi.mocked(store.storeResult).mockRejectedValueOnce(new Error("UNAVAILABLE"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = vi.fn().mockResolvedValue({ success: true });

    const first = await mod.withIdempotency("s", "k3", fn, { durable: true });
    const second = await mod.withIdempotency("s", "k3", fn, { durable: true });

    expect(first).toEqual({ result: { success: true }, duplicated: false });
    expect(second.duplicated).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("doesn't touch Firestore without the option, and doesn't store a failed run", async () => {
    await mod.withIdempotency("s", "k4", async () => ({ ok: true }));
    expect(store.getStoredResult).not.toHaveBeenCalled();
    expect(store.storeResult).not.toHaveBeenCalled();

    await expect(mod.withIdempotency("s", "k5", async () => { throw new Error("boom"); }, { durable: true })).rejects.toThrow("boom");
    expect(store.storeResult).not.toHaveBeenCalled();
  });
});
