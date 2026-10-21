/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePaypalSweeperStatus } from "./usePaypalSweeperStatus";

vi.mock("@/services/google-api", () => ({
  getPaypalSweeperStatus: vi.fn(),
  runPaypalSweepNow: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { getPaypalSweeperStatus, runPaypalSweepNow } from "@/services/google-api";
import { toast } from "sonner";

const mockedGetStatus = vi.mocked(getPaypalSweeperStatus);
const mockedRunNow = vi.mocked(runPaypalSweepNow);

const SAMPLE_STATUS = {
  credentialConfigured: true,
  credentialUpdatedBy: "staff@orns.org",
  credentialUpdatedAt: "2026-01-01T00:00:00.000Z",
  intervalMinutes: 5,
  scheduleActive: true,
  lastScheduledRunAt: "2026-01-01T00:05:00.000Z",
  lastRunAt: "2026-01-01T00:05:00.000Z",
  lastResult: { pending: 1, resolved: 1, escalated: 0 },
};

describe("usePaypalSweeperStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches status on mount", async () => {
    mockedGetStatus.mockResolvedValue(SAMPLE_STATUS);
    const { result } = renderHook(() => usePaypalSweeperStatus());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toEqual(SAMPLE_STATUS);
  });

  it("treats a failed status fetch as a non-crashing null status", async () => {
    mockedGetStatus.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => usePaypalSweeperStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBeNull();
  });

  it("runNow triggers a sweep, shows a success toast, and refreshes status", async () => {
    mockedGetStatus.mockResolvedValue(SAMPLE_STATUS);
    mockedRunNow.mockResolvedValue({ pending: 2, resolved: 2, escalated: 0 });
    const { result } = renderHook(() => usePaypalSweeperStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.runNow();
    });

    expect(mockedRunNow).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("2 pending, 2 resolved, 0 escalated"));
    // refresh() is called again after a successful run.
    expect(mockedGetStatus).toHaveBeenCalledTimes(2);
  });

  it("runNow shows an info toast for a skipped sweep instead of a success toast", async () => {
    mockedGetStatus.mockResolvedValue(SAMPLE_STATUS);
    mockedRunNow.mockResolvedValue({ skipped: "No background-sync credential stored yet." });
    const { result } = renderHook(() => usePaypalSweeperStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.runNow();
    });

    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("No background-sync credential"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("runNow shows an error toast and does not crash when the request fails", async () => {
    mockedGetStatus.mockResolvedValue(SAMPLE_STATUS);
    mockedRunNow.mockRejectedValue(new Error("Server exploded"));
    const { result } = renderHook(() => usePaypalSweeperStatus());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.runNow();
    });

    expect(toast.error).toHaveBeenCalledWith("Server exploded");
    expect(result.current.running).toBe(false);
  });

  it("polls for fresh status on an interval", async () => {
    vi.useFakeTimers();
    try {
      mockedGetStatus.mockResolvedValue(SAMPLE_STATUS);
      renderHook(() => usePaypalSweeperStatus());
      await vi.waitFor(() => expect(mockedGetStatus).toHaveBeenCalledTimes(1));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(mockedGetStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
