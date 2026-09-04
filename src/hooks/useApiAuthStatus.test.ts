/**
 * @vitest-environment jsdom
 *
 * useApiAuthStatus had zero test coverage. Confirmed while designing
 * these tests that the already-logged "postMessage listener doesn't
 * check event.origin" bug was real - and, per investigation, the
 * feature that would have legitimately sent this message (a server-side
 * HTML page at /auth/callback) was accidentally deleted in a past
 * server.ts refactor, so the listener is currently dead code with no
 * real sender - but still a live injection surface, since without an
 * origin check ANY page holding a reference to this window could inject
 * fake tokens for the app to trust. Fixed by rejecting any postMessage
 * whose origin isn't this app's own before reading event.data at all.
 * The "ignores a postMessage from a different origin" test below is the
 * regression guard for that fix.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useApiAuthStatus } from "./useApiAuthStatus";

vi.mock("@/services/google-api", () => ({
  getAuthStatus: vi.fn(),
}));

import { getAuthStatus } from "@/services/google-api";

const mockedGetAuthStatus = vi.mocked(getAuthStatus);

function postMessageEvent(data: any, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

describe("useApiAuthStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("checks auth status on mount and reflects the result", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: true });
    const { result } = renderHook(() => useApiAuthStatus());

    expect(result.current.isApiAuthenticated).toBeNull();
    await waitFor(() => expect(result.current.isApiAuthenticated).toBe(true));
  });

  it("reflects a false auth status", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    const { result } = renderHook(() => useApiAuthStatus());

    await waitFor(() => expect(result.current.isApiAuthenticated).toBe(false));
  });

  it("treats a failed status check as unauthenticated, not a crash", async () => {
    mockedGetAuthStatus.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useApiAuthStatus());

    await waitFor(() => expect(result.current.isApiAuthenticated).toBe(false));
  });

  it("re-checks auth and persists tokens on a same-origin OAUTH_AUTH_SUCCESS message", async () => {
    mockedGetAuthStatus.mockResolvedValueOnce({ authenticated: false }).mockResolvedValueOnce({ authenticated: true });
    const { result } = renderHook(() => useApiAuthStatus());
    await waitFor(() => expect(result.current.isApiAuthenticated).toBe(false));

    act(() => {
      postMessageEvent({ type: "OAUTH_AUTH_SUCCESS", tokens: { access_token: "tok-123" } });
    });

    expect(localStorage.getItem("google_tokens")).toBe(JSON.stringify({ access_token: "tok-123" }));
    await waitFor(() => expect(result.current.isApiAuthenticated).toBe(true));
    expect(getAuthStatus).toHaveBeenCalledTimes(2);
  });

  it("ignores a postMessage from a different origin (regression guard for the origin-check fix)", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    const { result } = renderHook(() => useApiAuthStatus());
    await waitFor(() => expect(result.current.isApiAuthenticated).toBe(false));

    act(() => {
      postMessageEvent({ type: "OAUTH_AUTH_SUCCESS", tokens: { access_token: "attacker-token" } }, "https://evil.example.com");
    });

    // No token should be persisted, and auth must not be re-checked.
    expect(localStorage.getItem("google_tokens")).toBeNull();
    expect(getAuthStatus).toHaveBeenCalledTimes(1);
  });

  it("ignores a same-origin message with an unrelated type", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    renderHook(() => useApiAuthStatus());
    await waitFor(() => expect(getAuthStatus).toHaveBeenCalledTimes(1));

    act(() => {
      postMessageEvent({ type: "SOME_OTHER_MESSAGE" });
    });

    expect(localStorage.getItem("google_tokens")).toBeNull();
    expect(getAuthStatus).toHaveBeenCalledTimes(1);
  });

  it("removes its message listener on unmount", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    const { unmount } = renderHook(() => useApiAuthStatus());
    await waitFor(() => expect(getAuthStatus).toHaveBeenCalledTimes(1));

    unmount();

    postMessageEvent({ type: "OAUTH_AUTH_SUCCESS", tokens: { access_token: "tok-123" } });

    // Give any (incorrectly still-attached) listener a chance to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(getAuthStatus).toHaveBeenCalledTimes(1);
  });
});
