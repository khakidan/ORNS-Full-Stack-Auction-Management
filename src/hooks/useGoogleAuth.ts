import { useState, useEffect, useRef } from "react";
import { getAuthStatus, getAuthUrl, logout } from "@/services/google-api";
import { toast } from "sonner";

export function useGoogleAuth() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  // Mirrors `authenticated` for the interval below to read without being
  // in its dependency array (which would tear down/recreate the interval
  // every time auth state changes).
  const authenticatedRef = useRef(authenticated);

  useEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);

  useEffect(() => {
    checkAuth();
    
    const handleAuthSuccess = (event: MessageEvent) => {
      // Reject postMessages from any other origin before trusting
      // event.data at all - without this, any page holding a reference to
      // this window could inject fake tokens for us to persist and trust.
      if (event.origin !== window.location.origin) return;
      console.log("[Auth] Received message:", event.data?.type);
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        if (event.data.tokens) {
          console.log("[Auth] Tokens received safely");
          try {
            localStorage.setItem('google_tokens', JSON.stringify(event.data.tokens));
            console.log("[Auth] Tokens saved to localStorage");
          } catch (e) {
            console.warn("[Auth] localStorage failed, storing in memory:", e);
            // _fallbackTokens is an intentional escape hatch for environments where
            // localStorage is blocked (e.g. cross-origin iframes). Not a type oversight.
            (window as any)._fallbackTokens = JSON.stringify(event.data.tokens);
          }
        } else {
          console.error("[Auth] No tokens contained in postMessage!");
        }
        checkAuth();
      }
    };
    
    window.addEventListener('message', handleAuthSuccess);

    // low-frequency fallback poll (every 5 seconds), only if not authenticated.
    // Reads authenticatedRef rather than calling checkAuth() from inside a
    // setState updater - updaters must be pure, and React (especially
    // StrictMode) can invoke them more than once, which would have doubled
    // these /auth/status requests.
    const interval = setInterval(() => {
      if (!authenticatedRef.current) {
        checkAuth();
      }
    }, 5000);

    return () => {
      window.removeEventListener('message', handleAuthSuccess);
      clearInterval(interval);
    };
  }, []);

  const checkAuth = async () => {
    try {
      const status = await getAuthStatus();
      setAuthenticated(status.authenticated);
    } catch (e) {
      setAuthenticated(false);
    }
  };

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
    await checkAuth();
  };

  return { authenticated, handleLogin, handleLogout };
}
