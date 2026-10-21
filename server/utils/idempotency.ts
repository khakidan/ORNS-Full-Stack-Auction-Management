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
const TTL_MS = 60 * 60 * 1000; // 1 hour

const completed = new Map<string, { timestamp: number; result: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

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
 */
export async function withIdempotency<T>(scope: string, key: unknown, fn: () => Promise<T>): Promise<IdempotentOutcome<T>> {
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
    return { result: (await running) as T, duplicated: true };
  }

  const run = fn();
  inFlight.set(fullKey, run);
  try {
    const result = await run;
    completed.set(fullKey, { timestamp: Date.now(), result });
    return { result, duplicated: false };
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
