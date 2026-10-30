/**
 * A simple in-process async mutex, keyed by resource. Google Sheets has no
 * row/range-level locking of its own, and this app runs as a single Node
 * process (not horizontally scaled), so a promise chain per key is enough
 * to fully serialize concurrent writers to the same resource without any
 * new infrastructure - see docs/agents/ROADMAP.md's "Concurrency Safety
 * for Simultaneous Bidder Operations" milestone for the real bugs this
 * closes (registerWalkInBidder/recordWinningBid both compute a "next open
 * slot" from a read, then write to it - two callers racing on the same
 * key can compute the same slot and the second write silently clobbers
 * the first).
 *
 * Different keys never block each other - only calls sharing the same key
 * queue up behind one another.
 */
const locks = new Map<string, Promise<void>>();
/** How many callers are waiting behind the holder, per key - read only by tests (`_waitingForLockForTesting`). */
const waiting = new Map<string, number>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Capture whoever's ahead of us, then immediately (synchronously, before
  // any await) claim the tail position for ourselves - JS's single-threaded
  // execution means this registration can't race with another synchronous
  // caller of withLock() for the same key.
  const queued = locks.has(key);
  const previousTail = locks.get(key) ?? Promise.resolve();
  let releaseThisTail: () => void;
  const thisTail = new Promise<void>((resolve) => { releaseThisTail = resolve; });
  locks.set(key, thisTail);

  // A tail only ever resolves, so no try/finally is needed around the count.
  if (queued) waiting.set(key, (waiting.get(key) ?? 0) + 1);
  await previousTail;
  if (queued) {
    const left = waiting.get(key)! - 1;
    if (left === 0) waiting.delete(key);
    else waiting.set(key, left);
  }
  try {
    return await fn();
  } finally {
    releaseThisTail!();
    // Only clean up if no one queued behind us - otherwise we'd delete the
    // next caller's own tail out from under them.
    if (locks.get(key) === thisTail) {
      locks.delete(key);
    }
  }
}

/** Thrown by runIfIdle when the same job is already running. */
export class AlreadyRunningError extends Error {
  constructor(message = "This is already running. Wait for it to finish, then check the folder before trying again.") {
    super(message);
    this.name = "AlreadyRunningError";
  }
}

const running = new Set<string>();

/**
 * Runs `fn` only if no other call with the same key is running; otherwise
 * throws AlreadyRunningError at once instead of queueing behind it.
 *
 * For work that isn't safe to repeat, such as an Apps Script run that
 * creates a document: a second click or a retried request while the
 * first is still going would make a second copy, so it's turned away
 * rather than run after the first one finishes (which withLock would do).
 */
export async function runIfIdle<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (running.has(key)) throw new AlreadyRunningError();
  running.add(key);
  try {
    return await fn();
  } finally {
    running.delete(key);
  }
}

/** Test-only: the number of keys currently held in the lock map, to verify cleanup actually happens rather than leaking an entry per key forever. */
export function _getLockMapSizeForTesting(): number {
  return locks.size;
}

/**
 * Test-only: how many callers are queued on `key` right now. A concurrency
 * test waits for this to reach 1 before releasing the holder - proof that
 * the second caller is held by the lock, not just slow to get there.
 */
export function _waitingForLockForTesting(key: string): number {
  return waiting.get(key) ?? 0;
}
