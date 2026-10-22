import { useSyncExternalStore } from "react";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";

/**
 * Winning bids saved on this device because the server couldn't be
 * reached (ROADMAP.md Milestone A). Instead of undoing a bid that can't
 * be sent - which used to mean someone had to notice and type it in again
 * - useWinnersData.ts puts it here. The outbox sends it once the
 * connection is back, oldest first, with the idempotency key it was made
 * with, so the server records it exactly once even if an earlier attempt
 * got through (record-winning-bid keeps keys for 24 hours,
 * server/services/idempotencyStore.ts).
 *
 * Kept in localStorage so a reload or a closed tab doesn't lose it. Only
 * winning bids are kept here: checkout, receipts and emails touch money or
 * email bidders, so they never run late.
 *
 * A bid the server refuses when it's resent (e.g. the item was won on
 * another device meanwhile - a 409) moves to "needsReview" with the
 * server's reason, for staff to deal with in the banner's review list.
 */
export interface RecordWinningBidBody {
  bidderId: string;
  itemId: string;
  price: number;
  spreadsheetId: string;
  bidManagementSheet: string;
  bidderNumbersSheet: string;
  itemsSpreadsheetId?: string;
  idempotencyKey: string;
}

export type OutboxStatus = "waiting" | "sending" | "needsReview";

export interface OutboxEntry {
  body: RecordWinningBidBody;
  /** For display - the outbox outlives the page that made it. */
  bidderName: string;
  itemName: string;
  createdAt: number;
  attempts: number;
  status: OutboxStatus;
  /** The server's reason, for a bid in needsReview. */
  problem?: string;
}

export interface OutboxState {
  entries: OutboxEntry[];
  /** Progress of a send in progress. */
  sending: { sent: number; total: number } | null;
  /** The server answered 401: nothing more can send until staff sign in again. */
  needsSignIn: boolean;
  /** When the last send run delivered at least one bid. */
  lastSentAt: number | null;
}

export interface SentBid {
  entry: OutboxEntry;
  response: { followUpAdded?: boolean };
}

export const OUTBOX_STORAGE_KEY = "orns.bidOutbox.v1";
const SEND_ATTEMPTS = 2; // per bid per run; the 30-second timer tries again after that
const LOCK_NAME = "orns-bid-outbox";

let state: OutboxState = { entries: load(), sending: null, needsSignIn: false, lastSentAt: null };
const listeners = new Set<() => void>();
const settledListeners = new Set<(sent: SentBid[], changed: boolean) => void>();

function load(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // A tab closed mid-send leaves "sending" behind - it never got an answer.
    return parsed
      .filter((e) => e && e.body && typeof e.body.idempotencyKey === "string")
      .map((e) => (e.status === "sending" ? { ...e, status: "waiting" } : e));
  } catch {
    return [];
  }
}

/** Whether the last save reached localStorage. While it hasn't, memory is the only copy. */
let storageOk = true;

/** False when this browser won't store it (private window, storage full). */
function save(): boolean {
  try {
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(state.entries));
    storageOk = true;
  } catch {
    storageOk = false;
  }
  return storageOk;
}

function set(patch: Partial<OutboxState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function updateEntry(key: string, patch: Partial<OutboxEntry>) {
  set({ entries: state.entries.map((e) => (e.body.idempotencyKey === key ? { ...e, ...patch } : e)) });
  save();
}

/**
 * Keeps a bid that couldn't be sent. Returns false if it could only be
 * kept in memory (this browser refused storage) - it still sends from
 * this tab, but won't survive a reload.
 */
export function addToOutbox(body: RecordWinningBidBody, display: { bidderName: string; itemName: string }): boolean {
  if (state.entries.some((e) => e.body.idempotencyKey === body.idempotencyKey)) return true;
  set({ entries: [...state.entries, { body, ...display, createdAt: Date.now(), attempts: 0, status: "waiting" }] });
  return save();
}

export function removeFromOutbox(idempotencyKey: string): void {
  set({ entries: state.entries.filter((e) => e.body.idempotencyKey !== idempotencyKey) });
  save();
}

/** Puts a needsReview bid back in line and sends it. */
export function retryOutboxEntry(idempotencyKey: string): Promise<void> {
  updateEntry(idempotencyKey, { status: "waiting", problem: undefined });
  return flushOutbox();
}

/** The server said the session expired while a bid was being recorded live. */
export function markNeedsSignIn(): void {
  set({ needsSignIn: true });
}

let flushing: Promise<void> | null = null;

/**
 * Sends every waiting bid, oldest first, one at a time. Safe to call as
 * often as you like: a run already in progress is joined, and another
 * tab's run (Web Locks) is left to finish on its own.
 */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  flushing = withTabLock(sendWaiting).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function withTabLock(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? (navigator as any).locks : undefined;
  if (locks?.request) {
    await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock: unknown) => {
      if (lock) await fn();
    });
    return;
  }
  await fn();
}

async function sendWaiting(): Promise<void> {
  // Another tab may have sent or added bids since this one last looked -
  // unless storage is refusing writes, when memory is the only copy.
  if (storageOk) set({ entries: load() });
  const queue = state.entries.filter((e) => e.status === "waiting").sort((a, b) => a.createdAt - b.createdAt);
  if (queue.length === 0 || (typeof navigator !== "undefined" && navigator.onLine === false)) return;

  set({ sending: { sent: 0, total: queue.length }, needsSignIn: false });
  const sent: SentBid[] = [];
  let changed = false;

  for (const entry of queue) {
    const key = entry.body.idempotencyKey;
    if (!state.entries.some((e) => e.body.idempotencyKey === key && e.status === "waiting")) continue;
    updateEntry(key, { status: "sending" });

    let res: Response;
    try {
      res = await fetchWithRetry(`${getBaseUrl()}/api/auction/record-winning-bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry.body),
        credentials: "include",
      }, SEND_ATTEMPTS);
    } catch {
      // Still can't reach the server: stop here and keep the order intact.
      updateEntry(key, { status: "waiting", attempts: entry.attempts + 1 });
      break;
    }

    if (res.ok) {
      const response = await res.json().catch(() => ({}));
      removeFromOutbox(key);
      sent.push({ entry, response });
      changed = true;
    } else if (res.status === 401) {
      updateEntry(key, { status: "waiting", attempts: entry.attempts + 1 });
      set({ needsSignIn: true });
      break;
    } else {
      const data = await res.json().catch(() => ({}));
      updateEntry(key, {
        status: "needsReview",
        attempts: entry.attempts + 1,
        problem: data.error || `The server refused this bid (error ${res.status}).`,
      });
      changed = true;
    }
    if (state.sending) set({ sending: { ...state.sending, sent: state.sending.sent + 1 } });
  }

  set({ sending: null, ...(sent.length > 0 ? { lastSentAt: Date.now() } : {}) });
  if (changed) settledListeners.forEach((l) => l(sent, changed));
}

/** Called after a send run that delivered or refused bids, so the winners list can refresh. */
export function onOutboxSettled(listener: (sent: SentBid[], changed: boolean) => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

export function getOutboxState(): OutboxState {
  return state;
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBidOutbox(): OutboxState {
  return useSyncExternalStore(subscribeOutbox, getOutboxState, getOutboxState);
}

// Another tab changed the outbox.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === OUTBOX_STORAGE_KEY) set({ entries: load() });
  });
}

/** Test-only. */
export function _resetOutboxForTesting(): void {
  try {
    localStorage.removeItem(OUTBOX_STORAGE_KEY);
  } catch {
    // ignore
  }
  flushing = null;
  storageOk = true;
  state = { entries: [], sending: null, needsSignIn: false, lastSentAt: null };
  listeners.forEach((l) => l());
}

/** Test-only: re-read storage, as a fresh page load would. */
export function _reloadOutboxForTesting(): void {
  set({ entries: load() });
}
