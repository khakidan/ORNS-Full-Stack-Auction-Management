import { expect, vi } from "vitest";
import { _waitingForLockForTesting } from "../../utils/asyncLock";

/**
 * Holds a fake (an MSW handler, a fake Sheets call) open until the test
 * says so, and tells the test when the fake got there - so a concurrency
 * test acts on a signal, never after a fixed `setTimeout`.
 *
 *   const gate = createGate();
 *   // in the fake:  await gate.wait();
 *   await gate.reached;   // the first call is now inside the fake
 *   gate.release();
 */
export function createGate() {
  let markReached!: () => void;
  let open!: () => void;
  const reached = new Promise<void>((resolve) => { markReached = resolve; });
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return {
    wait(): Promise<void> {
      markReached();
      return opened;
    },
    reached,
    release(): void {
      open();
    },
  };
}

/**
 * Waits until `count` callers are queued on the `withLock` key. Without the
 * lock nothing ever queues, so this times out and the test fails - unlike a
 * fixed wait, which a missing lock can slip past.
 */
export async function waitUntilQueuedOnLock(key: string, count = 1): Promise<void> {
  await vi.waitFor(() => expect(_waitingForLockForTesting(key)).toBe(count));
}
