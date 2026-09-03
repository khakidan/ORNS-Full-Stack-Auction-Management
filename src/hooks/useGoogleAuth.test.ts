/**
 * @vitest-environment jsdom
 *
 * useGoogleAuth had zero test coverage. Confirmed two already-logged bugs
 * were real while designing these tests:
 *
 * 1. The postMessage listener didn't check event.origin - same issue and
 *    same fix as useApiAuthStatus.ts (see that file's test header for the
 *    full investigation: the real sender was accidentally deleted from
 *    server.ts in a past refactor, so the listener is dead code today but
 *    was still a live injection surface with no origin check).
 * 2. checkAuth() was called from *inside* a setAuthenticated updater
 *    function in the 5-second fallback poll - updaters must be pure, and
 *    React (especially StrictMode) can invoke them more than once,
 *    doubling /auth/status requests. Fixed by reading a ref mirror of
 *    `authenticated` instead, which preserves the original "only poll
 *    while not yet authenticated" behavior without the impure updater.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useGoogleAuth } from "./useGoogleAuth";

vi.mock("@/services/google-api", () => ({
  getAuthStatus: vi.fn(),
  getAuthUrl: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

import { getAuthStatus, getAuthUrl, logout } from "@/services/google-api";
import { toast } from "sonner";

const mockedGetAuthStatus = vi.mocked(getAuthStatus);
const mockedGetAuthUrl = vi.mocked(getAuthUrl);
const mockedLogout = vi.mocked(logout);

function postMessageEvent(data: any, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

function mockLocation() {
  const location = { href: "", origin: "http://localhost:3000" };
  Object.defineProperty(window, "location", { configurable: true, value: location });
  return location;
}

describe("useGoogleAuth - mount and postMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLocation();
  });

  it("checks auth status on mount and reflects the result", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: true });
    const { result } = renderHook(() => useGoogleAuth());

    await waitFor(() => expect(result.current.authenticated).toBe(true));
  });

  it("treats a failed status check as unauthenticated", async () => {
    mockedGetAuthStatus.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useGoogleAuth());

    await waitFor(() => expect(result.current.authenticated).toBe(false));
  });

  it("re-checks auth and persists tokens on a same-origin OAUTH_AUTH_SUCCESS message", async () => {
    mockedGetAuthStatus.mockResolvedValueOnce({ authenticated: false }).mockResolvedValueOnce({ authenticated: true });
    const { result } = renderHook(() => useGoogleAuth());
    await waitFor(() => expect(result.current.authenticated).toBe(false));

    act(() => {
      postMessageEvent({ type: "OAUTH_AUTH_SUCCESS", tokens: { access_token: "tok-123" } });
    });

    expect(localStorage.getItem("google_tokens")).toBe(JSON.stringify({ access_token: "tok-123" }));
    await waitFor(() => expect(result.current.authenticated).toBe(true));
  });

  it("ignores a postMessage from a different origin (regression guard for the origin-check fix)", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    renderHook(() => useGoogleAuth());
    await waitFor(() => expect(getAuthStatus).toHaveBeenCalledTimes(1));

    act(() => {
      postMessageEvent({ type: "OAUTH_AUTH_SUCCESS", tokens: { access_token: "attacker-token" } }, "https://evil.example.com");
    });

    expect(localStorage.getItem("google_tokens")).toBeNull();
    expect(getAuthStatus).toHaveBeenCalledTimes(1);
  });

  it("falls back to window._fallbackTokens when localStorage.setItem throws", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("blocked"); };

    renderHook(() => useGoogleAuth());
    await waitFor(() => expect(getAuthStatus).toHaveBeenCalledTimes(1));

    act(() => {
      postMessageEvent({ type: "OAUTH_AUTH_SUCCESS", tokens: { access_token: "tok-123" } });
    });

    expect((window as any)._fallbackTokens).toBe(JSON.stringify({ access_token: "tok-123" }));

    Storage.prototype.setItem = originalSetItem;
    delete (window as any)._fallbackTokens;
  });
});

describe("useGoogleAuth - the 5-second fallback poll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLocation();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps polling while not authenticated", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    renderHook(() => useGoogleAuth());

    await vi.waitFor(() => expect(getAuthStatus).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getAuthStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getAuthStatus).toHaveBeenCalledTimes(3);
  });

  it("stops polling once authenticated (regression guard for the setState-updater fix)", async () => {
    mockedGetAuthStatus.mockResolvedValue({ authenticated: true });
    const { result } = renderHook(() => useGoogleAuth());

    // Wait for the real hook state (not just "the call started") so the
    // ref-sync effect has actually committed before advancing timers.
    await vi.waitFor(() => expect(result.current.authenticated).toBe(true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Already authenticated by the mount check - the poll must not fire
    // any additional /auth/status calls.
    expect(getAuthStatus).toHaveBeenCalledTimes(1);
  });
});

describe("useGoogleAuth - handleLogin (not embedded in an iframe)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
  });

  it("remembers the current path and redirects to the real auth URL", async () => {
    const location = mockLocation();
    (location as any).pathname = "/bidders";
    mockedGetAuthUrl.mockResolvedValue({ url: "https://accounts.google.com/o/oauth2/auth?real=1" });
    sessionStorage.clear();

    const { result } = renderHook(() => useGoogleAuth());
    await waitFor(() => expect(result.current.authenticated).toBe(false));

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(sessionStorage.getItem("post_auth_redirect_path")).toBe("/bidders");
    expect(location.href).toBe("https://accounts.google.com/o/oauth2/auth?real=1");
  });

  it("shows an error toast and does not redirect when the server returns no URL", async () => {
    mockLocation();
    mockedGetAuthUrl.mockResolvedValue({ error: "misconfigured" } as any);

    const { result } = renderHook(() => useGoogleAuth());
    await waitFor(() => expect(result.current.authenticated).toBe(false));

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(toast.error).toHaveBeenCalledWith("Auth server did not return a valid login URL.");
  });

  it("shows an error toast (not a crash) when fetching the auth URL throws", async () => {
    mockLocation();
    mockedGetAuthUrl.mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useGoogleAuth());
    await waitFor(() => expect(result.current.authenticated).toBe(false));

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(toast.error).toHaveBeenCalledWith("Could not reach auth server.");
  });
});

describe("useGoogleAuth - handleLogin (embedded in an iframe)", () => {
  let originalTop: any;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockedGetAuthStatus.mockResolvedValue({ authenticated: false });
    mockLocation();
    // Simulate window.self !== window.top.
    originalTop = window.top;
    Object.defineProperty(window, "top", { configurable: true, value: {} });
  });

  afterEach(() => {
    Object.defineProperty(window, "top", { configurable: true, value: originalTop });
  });

  it("opens a popup named 'oauth_popup' and navigates it to the real auth URL", async () => {
    mockedGetAuthUrl.mockResolvedValue({ url: "https://accounts.google.com/o/oauth2/auth?real=1" });
    const fakePopup = { location: { href: "" }, close: vi.fn() };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakePopup as any);

    const { result } = renderHook(() => useGoogleAuth());
    await waitFor(() => expect(result.current.authenticated).toBe(false));

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(openSpy).toHaveBeenCalledWith("about:blank", "oauth_popup", expect.any(String));
    expect(fakePopup.location.href).toBe("https://accounts.google.com/o/oauth2/auth?real=1");
  });

  it("shows a popup-blocked error and never fetches an auth URL when the popup is blocked", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    const { result } = renderHook(() => useGoogleAuth());
    await waitFor(() => expect(result.current.authenticated).toBe(false));

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(toast.error).toHaveBeenCalledWith("Popup blocked! Please allow popups for this site in your browser settings.");
    expect(getAuthUrl).not.toHaveBeenCalled();
  });

  it("closes the popup when the server returns no valid auth URL", async () => {
    mockedGetAuthUrl.mockResolvedValue({ error: "misconfigured" } as any);
    const fakePopup = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakePopup as any);

    const { result } = renderHook(() => useGoogleAuth());
    await waitFor(() => expect(result.current.authenticated).toBe(false));

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(fakePopup.close).toHaveBeenCalled();
  });
});

describe("useGoogleAuth - handleLogout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLocation();
  });

  it("logs out and re-checks auth status", async () => {
    mockedGetAuthStatus.mockResolvedValueOnce({ authenticated: true }).mockResolvedValueOnce({ authenticated: false });
    mockedLogout.mockResolvedValue(undefined as any);

    const { result } = renderHook(() => useGoogleAuth());
    await waitFor(() => expect(result.current.authenticated).toBe(true));

    await act(async () => {
      await result.current.handleLogout();
    });

    expect(logout).toHaveBeenCalled();
    expect(result.current.authenticated).toBe(false);
  });
});
