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

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Capture whoever's ahead of us, then immediately (synchronously, before
  // any await) claim the tail position for ourselves - JS's single-threaded
  // execution means this registration can't race with another synchronous
  // caller of withLock() for the same key.
  const previousTail = locks.get(key) ?? Promise.resolve();
  let releaseThisTail: () => void;
  const thisTail = new Promise<void>((resolve) => { releaseThisTail = resolve; });
  locks.set(key, thisTail);

  await previousTail;
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

/** Test-only: the number of keys currently held in the lock map, to verify cleanup actually happens rather than leaking an entry per key forever. */
export function _getLockMapSizeForTesting(): number {
  return locks.size;
}
