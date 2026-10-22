import { useSyncExternalStore } from "react";

/**
 * What fetchWithRetry is doing right now, for the sync banner
 * (ROADMAP.md Milestone A). fetchWithRetry used to retry silently - the
 * only trace was a console.warn - so staff couldn't tell a slow Google
 * Sheets from a click that did nothing.
 *
 * Each request that's between retries registers here under its own id;
 * the banner shows the highest attempt number among them. When the last
 * one recovers, `recoveredAt` is set so the banner can briefly say so.
 */
export interface RetryStatus {
  /** Requests currently waiting to retry (0 = nothing retrying). */
  retrying: number;
  /** The next attempt number of the furthest-along request (2 = first retry). */
  attempt: number;
  maxAttempts: number;
  /** When the last retrying request succeeded; null once cleared or after a failure. */
  recoveredAt: number | null;
}

const active = new Map<number, { attempt: number; maxAttempts: number }>();
let recoveredAt: number | null = null;
let snapshot: RetryStatus = { retrying: 0, attempt: 0, maxAttempts: 0, recoveredAt: null };
const listeners = new Set<() => void>();
let nextId = 1;

function publish() {
  let attempt = 0;
  let maxAttempts = 0;
  for (const r of active.values()) {
    if (r.attempt > attempt) {
      attempt = r.attempt;
      maxAttempts = r.maxAttempts;
    }
  }
  snapshot = { retrying: active.size, attempt, maxAttempts, recoveredAt };
  listeners.forEach((l) => l());
}

/** A fresh id for one fetchWithRetry call. */
export function newRequestId(): number {
  return nextId++;
}

/** This request failed and will try again as attempt `attempt` of `maxAttempts`. */
export function reportRetry(id: number, attempt: number, maxAttempts: number): void {
  active.set(id, { attempt, maxAttempts });
  recoveredAt = null;
  publish();
}

/** This request is finished. `succeeded` is false when it ran out of attempts. */
export function reportDone(id: number, succeeded: boolean): void {
  if (!active.delete(id)) return;
  recoveredAt = succeeded && active.size === 0 ? Date.now() : null;
  publish();
}

/** Clears the "responding again" note once the banner has shown it. */
export function clearRecovered(): void {
  if (recoveredAt === null) return;
  recoveredAt = null;
  publish();
}

export function getRetryStatus(): RetryStatus {
  return snapshot;
}

export function subscribeRetryStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRetryStatus(): RetryStatus {
  return useSyncExternalStore(subscribeRetryStatus, getRetryStatus, getRetryStatus);
}

/** Test-only. */
export function _resetRetryStatusForTesting(): void {
  active.clear();
  recoveredAt = null;
  snapshot = { retrying: 0, attempt: 0, maxAttempts: 0, recoveredAt: null };
  listeners.forEach((l) => l());
}
