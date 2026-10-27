/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useChangeFeed } from "./useChangeFeed";

vi.mock("@/services/google-api", () => ({ getBaseUrl: () => "" }));
vi.mock("sonner", () => ({ toast: { info: vi.fn() } }));
import { toast } from "sonner";

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

  it("shows other people's notices (an Undo) as a toast, but not your own or ones from before the page loaded", async () => {
    const undo = (by: string) => ({ version: 0, message: `${by} undid an action: Checked in bidder 104.`, by });
    fetchMock
      .mockResolvedValueOnce(answer({ version: 3, changed: [], notices: [undo("old@orns.org")], reset: false }))
      .mockResolvedValueOnce(answer({ version: 5, changed: ["bm"], notices: [undo("dan@orns.org"), undo("sam@orns.org")], reset: false }));

    const { result } = renderHook(() => useChangeFeed(true, vi.fn(), "sam@orns.org"));
    await act(async () => {});
    await act(async () => { await result.current(); });

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("dan@orns.org undid an action: Checked in bidder 104.", expect.anything());
  });

  it("does nothing while signed out", async () => {
    renderHook(() => useChangeFeed(false, vi.fn()));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
