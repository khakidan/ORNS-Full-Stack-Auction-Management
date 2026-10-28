import { useEffect, useRef } from "react";
import { getAuthUrl, logout } from "@/services/google-api";
import { toast } from "sonner";
import { useApiAuthStatus } from "@/hooks/useApiAuthStatus";

/**
 * Adds the login/logout flow and a low-frequency fallback poll (which
 * also picks up a sign-in completed in another tab) on top of
 * useApiAuthStatus.ts's shared auth-status check, rather than
 * duplicating it - both hooks used to mount their own independent copy
 * (from AuctionContext.tsx and App.tsx respectively), doubling every
 * /auth/status request.
 */
export function useGoogleAuth() {
  const { isApiAuthenticated: authenticated, user, signedOutReason, checkProviderAuth } = useApiAuthStatus();
  const isVolunteer = user?.role === "volunteer";

  // Mirrors `authenticated` for the poll below to read without being in
  // its dependency array (which would tear down/recreate the interval
  // every time auth state changes).
  const authenticatedRef = useRef(authenticated);
  useEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);

  useEffect(() => {
    // low-frequency fallback poll (every 5 seconds), only if not authenticated.
    // Reads authenticatedRef rather than calling checkProviderAuth() from
    // inside a setState updater - updaters must be pure, and React
    // (especially StrictMode) can invoke them more than once, which would
    // have doubled these /auth/status requests.
    const interval = setInterval(() => {
      if (!authenticatedRef.current) {
        checkProviderAuth();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [checkProviderAuth]);

  // A volunteer's access ends when the auction closes (or an organizer
  // revokes it). Re-check every 30 seconds so their screen says so instead
  // of every request quietly failing.
  useEffect(() => {
    if (!isVolunteer) return;
    const interval = setInterval(checkProviderAuth, 30000);
    return () => clearInterval(interval);
  }, [isVolunteer, checkProviderAuth]);

  const handleLogin = async () => {
    // /auth/callback's page reads this back to return the user to the
    // page they signed in from (see authRoutes.ts).
    try {
      sessionStorage.setItem('post_auth_redirect_path', window.location.pathname);
    } catch (e) {
      console.warn("sessionStorage failed:", e);
    }

    try {
      const response = await getAuthUrl();

      if (response.error || !response.url) {
        console.error("Server returned auth error:", response?.error || "Unknown error");
        toast.error("Auth server did not return a valid login URL.");
        return;
      }

      window.location.href = response.url;
    } catch (error) {
      console.error("Login failed with fetch error:", error);
      toast.error("Could not reach auth server.");
    }
  };

  const handleLogout = async () => {
    await logout();
    await checkProviderAuth();
  };

  return { authenticated, user, signedOutReason, handleLogin, handleLogout, checkAuth: checkProviderAuth };
}
