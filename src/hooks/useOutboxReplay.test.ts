/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/lib/bidOutbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bidOutbox")>();
  return { ...actual, flushOutbox: vi.fn(async () => {}) };
});
vi.mock("@/services/google-api", () => ({ fetchWithRetry: vi.fn(), getBaseUrl: () => "" }));

import { addToOutbox, flushOutbox, _resetOutboxForTesting } from "@/lib/bidOutbox";
import { OUTBOX_RETRY_INTERVAL_MS, useOutboxReplay } from "./useOutboxReplay";

const body = { bidderId: "1", itemId: "2", price: 3, spreadsheetId: "ss", bidManagementSheet: "B", bidderNumbersSheet: "N", idempotencyKey: "k" };

describe("useOutboxReplay", () => {
  beforeEach(() => {
    _resetOutboxForTesting();
    vi.mocked(flushOutbox).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("sends saved bids on sign-in and when the browser comes back online - not while signed out", () => {
    const { rerender } = renderHook(({ auth }) => useOutboxReplay(auth), { initialProps: { auth: false } });
    window.dispatchEvent(new Event("online"));
    expect(flushOutbox).not.toHaveBeenCalled();

    rerender({ auth: true });
    expect(flushOutbox).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("online"));
    expect(flushOutbox).toHaveBeenCalledTimes(2);
  });

  it("tries again every 30 seconds while bids are waiting", () => {
    vi.useFakeTimers();
    renderHook(() => useOutboxReplay(true));
    act(() => {
      addToOutbox(body, { bidderName: "A", itemName: "B" });
    });
    vi.mocked(flushOutbox).mockClear();

    act(() => vi.advanceTimersByTime(OUTBOX_RETRY_INTERVAL_MS));
    expect(flushOutbox).toHaveBeenCalledTimes(1);
  });

  it("asks before the tab closes while bids are waiting", () => {
    renderHook(() => useOutboxReplay(true));
    const idle = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);

    act(() => {
      addToOutbox(body, { bidderName: "A", itemName: "B" });
    });
    const busy = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(busy);
    expect(busy.defaultPrevented).toBe(true);
  });
});
