import { useCallback, useEffect, useState } from "react";
import { getAuthStatus } from "@/services/google-api";
import type { AuthUser } from "@/lib/permissions";

/**
 * Tracks whether the backend's Google API client is authenticated - i.e.
 * whether this browser holds a valid orns_session cookie. `checkProviderAuth`
 * is exposed so callers - e.g. useGoogleAuth.ts, which builds its
 * login/logout/fallback-poll flow on top of this hook - can force a
 * re-check on demand (after logout, or from a fallback poll).
 */
export function useApiAuthStatus() {
  const [isApiAuthenticated, setIsApiAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const checkProviderAuth = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      setIsApiAuthenticated(status.authenticated);
      setUser(status.authenticated ? status.user ?? null : null);
    } catch {
      setIsApiAuthenticated(false);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    // One-time cleanup: when the app ran inside AI Studio's iframe, OAuth
    // tokens (including the long-lived refresh token) were copied into
    // localStorage. Nothing reads them any more - the session cookie is
    // the only credential - so drop any copy a browser still has.
    try {
      localStorage.removeItem("google_tokens");
    } catch {
      // localStorage unavailable - nothing stored there to clean up.
    }

    checkProviderAuth();
  }, [checkProviderAuth]);

  return { isApiAuthenticated, user, checkProviderAuth };
}
