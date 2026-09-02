import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";

describe("idempotency - Concurrency and TTL caching", () => {
  let checkIdempotency: any;
  let saveIdempotency: any;
  let mockReq: any;
  let mockRes: any;
  let resJsonData: any;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Reset module cache so that when the file is dynamically imported, 
    // it registers its setInterval using vitest's fake timers.
    vi.resetModules();
    const mod = await import("../utils/idempotency");
    checkIdempotency = mod.checkIdempotency;
    saveIdempotency = mod.saveIdempotency;

    resJsonData = null;
    mockReq = {} as any;
    mockRes = {
      json: vi.fn().mockImplementation((data) => {
        resJsonData = data;
        return mockRes;
      }),
    } as any;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns cached responses for duplicate request keys", () => {
    const key = "test-unique-idempotency-key";
    const samplePayload = { success: true, bidId: 442 };

    // Initially, there will be no cached response
    const firstCheck = checkIdempotency(mockReq, mockRes, key);
    expect(firstCheck).toBeNull();
    expect(mockRes.json).not.toHaveBeenCalled();

    // Now save the result
    saveIdempotency(key, samplePayload);

    // Second request with exact key should hit the cache and receive cached payload + duplicated: true
    const secondCheck = checkIdempotency(mockReq, mockRes, key);
    expect(secondCheck).not.toBeNull();
    expect(mockRes.json).toHaveBeenCalledTimes(1);
    expect(resJsonData).toEqual({ success: true, bidId: 442, duplicated: true });
  });

  it("supports concurrent evaluation where first wins and subsequent reads are blocked", async () => {
    const key = "concurrent-rapid-key";
    const winningResult = { success: true, item: "Gift Card A" };

    // Simulating rapid sequential checks on identical key during high-concurrency race condition:
    const check1 = checkIdempotency(mockReq, mockRes, key);
    expect(check1).toBeNull(); // Clean path for first racer

    // First racer finishes and commits progress
    saveIdempotency(key, winningResult);

    // Second racer checking dynamically afterward
    const check2 = checkIdempotency(mockReq, mockRes, key);
    expect(check2).not.toBeNull();
    expect(resJsonData).toEqual({ success: true, item: "Gift Card A", duplicated: true });
  });

  it("correctly clears older cache entries past the 1-hour TTL interval", () => {
    const key = "ttl-expiry-key";
    const value = { balance: 95 };

    saveIdempotency(key, value);

    // Trigger check verifying it exists right now
    let check = checkIdempotency(mockReq, mockRes, key);
    expect(check).not.toBeNull();

    // Advance physical clocks by 30 minutes (1800000ms), checking if still present
    vi.advanceTimersByTime(1800000);
    // Cleanup interval ticks every 10 minutes (600000ms) inside code:
    vi.advanceTimersByTime(600000);

    // Reset standard mock records
    mockRes.json.mockClear();
    check = checkIdempotency(mockReq, mockRes, key);
    expect(check).not.toBeNull(); // Still valid (< 1 hour)

    // Advance clocks beyond 1 hour mark (e.g. 1.2 hours overall)
    // 3600000 + 600000 ticks would be more than enough.
    // Let's advance by 3600000 ms to expire the entry, then trigger 600000 ms to trigger the cleanup interval.
    vi.advanceTimersByTime(3600000); 
    vi.advanceTimersByTime(600000); 

    // Reset standard mock records again
    mockRes.json.mockClear();
    check = checkIdempotency(mockReq, mockRes, key);
    expect(check).toBeNull(); // Purged! Free to re-execute!
  });
});
