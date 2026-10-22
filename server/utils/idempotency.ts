/**
 * Idempotency for mutating routes: a client sends a fresh
 * `idempotencyKey` with each logical action, and fetchWithRetry
 * (src/services/google-api.ts) reuses the same request body - and so the
 * same key - on its automatic retries.
 *
 * A key is tracked from the moment its first request starts, not only
 * once it finishes (ROADMAP.md H6). A retry that arrives while the first
 * request is still running waits for that same run and gets its result,
 * instead of performing the action a second time. If the first run
 * fails, every request waiting on it fails too and nothing is cached, so
 * a later retry runs the action again.
 *
 * Keys are namespaced per route (`scope`), so the same key sent to two
 * different routes never returns one route's cached response from the
 * other.
 */
import { getStoredResult, storeResult } from "../services/idempotencyStore";

const TTL_MS = 60 * 60 * 1000; // 1 hour

const completed = new Map<string, { timestamp: number; result: unknown }>();
const inFlight = new Map<string, Promise<{ result: unknown }>>();

// Drop completed entries past the TTL (in-flight entries clean themselves up).
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of completed.entries()) {
    if (now - value.timestamp > TTL_MS) {
      completed.delete(key);
    }
  }
}, 10 * 60 * 1000).unref?.();

export interface IdempotentOutcome<T> {
  result: T;
  /** true when this request reused an earlier (or still-running) request's result instead of running the action. */
  duplicated: boolean;
}

/**
 * Runs `fn` at most once per (`scope`, `key`) within the TTL. Without a
 * usable key (missing, empty, or not a string), `fn` simply runs.
 *
 * `durable: true` also remembers the result in Firestore for 24 hours
 * (services/idempotencyStore.ts), so a request resent after a Cloud Run
 * restart - or long after it was made, from a device that was offline -
 * still gets the first result instead of running again. Used by
 * record-winning-bid (ROADMAP.md Milestone A). The Firestore lookup runs
 * inside the in-flight promise, so two copies arriving together still run
 * `fn` once. If Firestore is unreachable, this behaves like the in-memory
 * version.
 */
export async function withIdempotency<T>(
  scope: string,
  key: unknown,
  fn: () => Promise<T>,
  opts: { durable?: boolean } = {}
): Promise<IdempotentOutcome<T>> {
  if (typeof key !== "string" || key === "") {
    return { result: await fn(), duplicated: false };
  }

  const fullKey = `${scope}:${key}`;

  const done = completed.get(fullKey);
  if (done) {
    console.log(`[Idempotency] Request already processed: ${fullKey}`);
    return { result: done.result as T, duplicated: true };
  }

  const running = inFlight.get(fullKey);
  if (running) {
    console.log(`[Idempotency] Request already in progress, waiting for it: ${fullKey}`);
    const outcome = (await running) as { result: T };
    return { result: outcome.result, duplicated: true };
  }

  const run = (async (): Promise<{ result: T; fromStore: boolean }> => {
    if (opts.durable) {
      const stored = await getStoredResult(fullKey).catch((e: any) => {
        console.warn(`[Idempotency] Couldn't read the durable record for ${fullKey}; relying on memory only:`, e?.message || e);
        return undefined;
      });
      if (stored) {
        console.log(`[Idempotency] Request already processed (durable record): ${fullKey}`);
        return { result: stored.result as T, fromStore: true };
      }
    }
    const result = await fn();
    if (opts.durable) {
      await storeResult(fullKey, result).catch((e: any) => {
        console.warn(`[Idempotency] Couldn't save the durable record for ${fullKey}:`, e?.message || e);
      });
    }
    return { result, fromStore: false };
  })();
  inFlight.set(fullKey, run);
  try {
    const { result, fromStore } = await run;
    completed.set(fullKey, { timestamp: Date.now(), result });
    return { result, duplicated: fromStore };
  } finally {
    inFlight.delete(fullKey);
  }
}

/** Response body for an idempotent route: the result, flagged when it was reused. */
export function idempotentBody<T extends object>(outcome: IdempotentOutcome<T>): T & { duplicated?: true } {
  return outcome.duplicated ? { ...outcome.result, duplicated: true as const } : outcome.result;
}

/** Test-only: forget every cached and in-flight key. */
export function _resetIdempotencyForTesting(): void {
  completed.clear();
  inFlight.clear();
}
