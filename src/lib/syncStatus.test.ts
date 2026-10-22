/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { clearRecovered, getRetryStatus, newRequestId, reportDone, reportRetry, _resetRetryStatusForTesting } from "./syncStatus";

describe("syncStatus", () => {
  beforeEach(() => _resetRetryStatusForTesting());

  it("reports the furthest-along attempt across requests that are retrying", () => {
    const a = newRequestId();
    const b = newRequestId();
    reportRetry(a, 2, 4);
    reportRetry(b, 3, 4);
    expect(getRetryStatus()).toMatchObject({ retrying: 2, attempt: 3, maxAttempts: 4, recoveredAt: null });
  });

  it("notes the recovery only when the last retrying request succeeds", () => {
    const a = newRequestId();
    const b = newRequestId();
    reportRetry(a, 2, 4);
    reportRetry(b, 2, 4);

    reportDone(a, true);
    expect(getRetryStatus().recoveredAt).toBeNull();
    reportDone(b, true);
    expect(getRetryStatus()).toMatchObject({ retrying: 0, recoveredAt: expect.any(Number) });

    clearRecovered();
    expect(getRetryStatus().recoveredAt).toBeNull();
  });

  it("notes no recovery when the request ran out of attempts", () => {
    const a = newRequestId();
    reportRetry(a, 4, 4);
    reportDone(a, false);
    expect(getRetryStatus()).toMatchObject({ retrying: 0, recoveredAt: null });
  });

  it("ignores requests that finished without ever retrying", () => {
    reportDone(newRequestId(), true);
    expect(getRetryStatus()).toMatchObject({ retrying: 0, recoveredAt: null });
  });
});
