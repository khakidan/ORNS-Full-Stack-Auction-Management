import { useEffect, useRef } from "react";
import { getAuthUrl, logout } from "@/services/google-api";
import { toast } from "sonner";
import { useApiAuthStatus } from "@/hooks/useApiAuthStatus";

/**
 * Adds the login/logout flow and a low-frequency fallback poll on top of
 * useApiAuthStatus.ts's shared auth-status-check + postMessage-listener
 * logic, rather than duplicating that flow - both hooks used to mount
 * their own independent copy (from AuctionContext.tsx and App.tsx
 * respectively), doubling every OAuth completion's /auth/status requests
 * and localStorage writes.
 */
export function useGoogleAuth() {
  const { isApiAuthenticated: authenticated, checkProviderAuth } = useApiAuthStatus();

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

  const handleLogin = async () => {
    // Check if we are inside an iframe (like the AI Studio preview environment)
    const isIframe = window.self !== window.top;

    if (!isIframe) {
      try {
        sessionStorage.setItem('post_auth_redirect_path', window.location.pathname);
      } catch (e) {
        console.warn("sessionStorage failed:", e);
      }
    }

    let popup: Window | null = null;
    if (isIframe) {
      // Open popup immediately so standard browser doesn't block it as a non-user action (losing click context in awaits)
      popup = window.open("about:blank", "oauth_popup", "width=600,height=700");
      if (!popup) {
        toast.error("Popup blocked! Please allow popups for this site in your browser settings.");
        return;
      }
    }

    try {
      console.log("Handle login clicked, fetching auth URL...");
      const response = await getAuthUrl();

      if (response.error || !response.url) {
        console.error("Server returned auth error:", response?.error || "Unknown error");
        toast.error("Auth server did not return a valid login URL.");
        if (popup) popup.close();
        return;
      }

      console.log("Redirecting to:", response.url.substring(0, 50) + "...");
      if (isIframe && popup) {
        popup.location.href = response.url;
      } else {
        window.location.href = response.url;
      }
    } catch (error) {
      console.error("Login failed with fetch error:", error);
      toast.error("Could not reach auth server.");
      if (popup) popup.close();
    }
  };

  const handleLogout = async () => {
    await logout();
    await checkProviderAuth();
  };

  return { authenticated, handleLogin, handleLogout };
}
