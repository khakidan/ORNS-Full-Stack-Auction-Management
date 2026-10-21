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
