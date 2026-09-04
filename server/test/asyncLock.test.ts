import { describe, it, expect } from "vitest";
import { withLock, _getLockMapSizeForTesting } from "../utils/asyncLock";

/** A promise plus its externally-callable resolve, for precisely controlling ordering in tests. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("withLock", () => {
  it("serializes two calls sharing the same key - the second doesn't start until the first finishes", async () => {
    const events: string[] = [];
    const firstGate = deferred();

    const first = withLock("key-a", async () => {
      events.push("first-start");
      await firstGate.promise;
      events.push("first-end");
      return "first-result";
    });

    // Give the first call a tick to actually start (claim the lock) before queuing the second.
    await Promise.resolve();

    const second = withLock("key-a", async () => {
      events.push("second-start");
      return "second-result";
    });

    // The second call must not have started yet - it's queued behind the first.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first-start"]);

    firstGate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(events).toEqual(["first-start", "first-end", "second-start"]);
    expect(firstResult).toBe("first-result");
    expect(secondResult).toBe("second-result");
  });

  it("does not block calls with a different key - they run concurrently", async () => {
    const events: string[] = [];
    const gateA = deferred();

    const callA = withLock("key-a", async () => {
      events.push("a-start");
      await gateA.promise;
      events.push("a-end");
    });

    await Promise.resolve();

    // key-b must be able to start and finish while key-a is still held.
    const callB = withLock("key-b", async () => {
      events.push("b-start");
      events.push("b-end");
    });

    await callB;
    expect(events).toEqual(["a-start", "b-start", "b-end"]);

    gateA.resolve();
    await callA;
    expect(events).toEqual(["a-start", "b-start", "b-end", "a-end"]);
  });

  it("releases the lock even when the held function throws, so the next queued caller still runs", async () => {
    const events: string[] = [];

    const first = withLock("key-c", async () => {
      events.push("first");
      throw new Error("boom");
    });

    await Promise.resolve();

    const second = withLock("key-c", async () => {
      events.push("second");
      return "ok";
    });

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(events).toEqual(["first", "second"]);
  });

  it("propagates the held function's return value", async () => {
    const result = await withLock("key-d", async () => 42);
    expect(result).toBe(42);
  });

  it("cleans up its map entry once the queue drains, so unrelated keys never leak state across calls", async () => {
    await withLock("key-e", async () => {});
    // A fresh call with the same key afterward must not be stuck waiting on
    // a stale entry - it should run immediately.
    const events: string[] = [];
    await withLock("key-e", async () => { events.push("ran"); });
    expect(events).toEqual(["ran"]);
  });

  it("actually removes the key from the internal map once its queue drains, rather than retaining a resolved entry forever", async () => {
    const before = _getLockMapSizeForTesting();
    await withLock("key-f", async () => {});
    expect(_getLockMapSizeForTesting()).toBe(before);
  });
});
