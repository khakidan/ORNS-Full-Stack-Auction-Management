/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useChangeFeed } from "./useChangeFeed";

vi.mock("@/services/google-api", () => ({ getBaseUrl: () => "" }));

const answer = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe("useChangeFeed", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("takes the first answer as the starting point, then reports what changed since, every 5 seconds", async () => {
    const onChange = vi.fn();
    fetchMock
      .mockResolvedValueOnce(answer({ version: 7, changed: [], reset: false }))
      .mockResolvedValueOnce(answer({ version: 7, changed: [], reset: false }))
      .mockResolvedValueOnce(answer({ version: 9, changed: ["bm-sheet"], reset: false }));

    renderHook(() => useChangeFeed(true, onChange));
    await act(async () => {});
    expect(fetchMock).toHaveBeenLastCalledWith("/api/changes?since=0", { credentials: "include" });

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/changes?since=7", expect.anything());
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(onChange).toHaveBeenCalledWith(new Set(["bm-sheet"]), false);
  });

  it("passes on a server restart (reset) so everything reloads", async () => {
    const onChange = vi.fn();
    fetchMock
      .mockResolvedValueOnce(answer({ version: 40, changed: [], reset: false }))
      .mockResolvedValueOnce(answer({ version: 2, changed: [], reset: true }));

    const { result } = renderHook(() => useChangeFeed(true, onChange));
    await act(async () => {});
    await act(async () => { await result.current(); });

    expect(onChange).toHaveBeenCalledWith(new Set(), true);
  });

  it("does nothing while signed out", async () => {
    renderHook(() => useChangeFeed(false, vi.fn()));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
