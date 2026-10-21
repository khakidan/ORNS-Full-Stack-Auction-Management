/**
 * @vitest-environment jsdom
 *
 * useApiAuthStatus reports whether the browser has a valid session
 * cookie (via /auth/status). It used to also listen for an
 * OAUTH_AUTH_SUCCESS postMessage and copy the OAuth tokens it carried
 * into localStorage - a bridge that only existed for running inside AI
 * Studio's iframe. That bridge is gone; the tests below also guard that
 * it stays gone and that any copy a browser kept is cleaned up.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useApiAuthStatus } from "./useApiAuthStatus";

vi.mock("@/services/google-api", () => ({
  getAuthStatus: vi.fn(),
}));

import { getAuthStatus } from "@/services/google-api";

const mockedGetAuthStatus = vi.mocked(getAuthStatus);

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

  it("removes OAuth tokens a browser kept in localStorage from the old iframe login", async () => {
    localStorage.setItem("google_tokens", JSON.stringify({ access_token: "old", refresh_token: "old-refresh" }));
    mockedGetAuthStatus.mockResolvedValue({ authenticated: true });

    renderHook(() => useApiAuthStatus());

    await waitFor(() => expect(getAuthStatus).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem("google_tokens")).toBeNull();
  });

  it("ignores an OAUTH_AUTH_SUCCESS postMessage - tokens are never accepted from page messages", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    renderHook(() => useApiAuthStatus());
    await waitFor(() => expect(getAuthStatus).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: "OAUTH_AUTH_SUCCESS", tokens: { access_token: "injected" } },
        origin: window.location.origin,
      }));
    });

    expect(localStorage.getItem("google_tokens")).toBeNull();
    expect(getAuthStatus).toHaveBeenCalledTimes(1);
  });
});
