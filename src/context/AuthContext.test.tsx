/**
 * @vitest-environment jsdom
 *
 * AuthContext.tsx is new: it wraps useGoogleAuth.ts (itself already
 * thoroughly tested directly) in a single, app-wide Provider so
 * App.tsx and AuctionContext.tsx share one live instance instead of each
 * mounting their own copy of the auth-status-check/postMessage-listener/
 * poll flow - see CHANGELOG.md for why.
 * useGoogleAuth.ts itself is mocked here since its own real behavior is
 * already covered by useGoogleAuth.test.ts - this file only pins the
 * Provider/useAuth wiring: the hook's return value passes through
 * unchanged, multiple consumers under one Provider see the same values,
 * and useAuth() throws a clear error outside a Provider.
 */
import { render, renderHook, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const mockUseGoogleAuth = vi.fn();
vi.mock("@/hooks/useGoogleAuth", () => ({
  useGoogleAuth: () => mockUseGoogleAuth(),
}));

describe("AuthContext", () => {
  beforeEach(() => {
    mockUseGoogleAuth.mockClear();
  });

  it("throws a clear error when useAuth is called outside an AuthProvider", () => {
    // Swallow the expected React error-boundary console noise for this one assertion.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow("useAuth must be used within an AuthProvider");
    consoleSpy.mockRestore();
  });

  it("passes useGoogleAuth's return value through unchanged", () => {
    const handleLogin = vi.fn();
    const handleLogout = vi.fn();
    mockUseGoogleAuth.mockReturnValue({ authenticated: true, handleLogin, handleLogout });

    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });

    expect(result.current.authenticated).toBe(true);
    expect(result.current.handleLogin).toBe(handleLogin);
    expect(result.current.handleLogout).toBe(handleLogout);
  });

  it("reflects authenticated: null and authenticated: false the same way it reflects true", () => {
    mockUseGoogleAuth.mockReturnValue({ authenticated: null, handleLogin: vi.fn(), handleLogout: vi.fn() });
    const { result, rerender } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });
    expect(result.current.authenticated).toBeNull();

    mockUseGoogleAuth.mockReturnValue({ authenticated: false, handleLogin: vi.fn(), handleLogout: vi.fn() });
    rerender();
    expect(result.current.authenticated).toBe(false);
  });

  it("gives multiple consumers under one Provider the same authenticated value - a single shared instance, not two independent ones", () => {
    mockUseGoogleAuth.mockReturnValue({ authenticated: true, handleLogin: vi.fn(), handleLogout: vi.fn() });

    function ConsumerA() {
      const { authenticated } = useAuth();
      return <span data-testid="consumer-a">{String(authenticated)}</span>;
    }
    function ConsumerB() {
      const { authenticated } = useAuth();
      return <span data-testid="consumer-b">{String(authenticated)}</span>;
    }

    render(
      <AuthProvider>
        <ConsumerA />
        <ConsumerB />
      </AuthProvider>
    );

    expect(screen.getByTestId("consumer-a").textContent).toBe("true");
    expect(screen.getByTestId("consumer-b").textContent).toBe("true");
    // Only one underlying useGoogleAuth instance backs both consumers -
    // the Provider calls it once, not once per consumer.
    expect(mockUseGoogleAuth).toHaveBeenCalledTimes(1);
  });

  it("can() answers from the signed-in person's capabilities, and is false while signed out", () => {
    mockUseGoogleAuth.mockReturnValue({
      authenticated: true,
      user: { email: "jane@orns.org", role: "admin", roleLabel: "Administrator", capabilities: ["auction.stage", "attendees.delete"] },
      handleLogin: vi.fn(),
      handleLogout: vi.fn(),
    });
    const { result, rerender } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });

    expect(result.current.can("auction.stage")).toBe(true);
    expect(result.current.can("settings")).toBe(false);

    mockUseGoogleAuth.mockReturnValue({ authenticated: false, user: null, handleLogin: vi.fn(), handleLogout: vi.fn() });
    rerender();
    expect(result.current.can("auction.stage")).toBe(false);
  });
});
