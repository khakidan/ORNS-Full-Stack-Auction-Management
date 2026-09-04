import { useCallback, useEffect, useState } from "react";
import { getAuthStatus } from "@/services/google-api";

/**
 * Persists OAuth tokens carried by an `OAUTH_AUTH_SUCCESS` postMessage.
 * Falls back to an in-memory `window` property when `localStorage` itself
 * is blocked (e.g. cross-origin iframes) - an intentional escape hatch,
 * not a type oversight.
 */
function persistTokens(tokens: unknown) {
  try {
    localStorage.setItem('google_tokens', JSON.stringify(tokens));
    console.log("[Auth] Tokens saved to localStorage");
  } catch (e) {
    console.warn("[Auth] localStorage failed, storing in memory:", e);
    (window as any)._fallbackTokens = JSON.stringify(tokens);
  }
}

/**
 * Tracks whether the backend's Google API client is authenticated, and
 * listens for the OAuth popup's `postMessage` success signal (persisting
 * any tokens it carries) to re-check status without a full page reload.
 * `checkProviderAuth` is exposed so callers - e.g. useGoogleAuth.ts, which
 * builds its login/logout/fallback-poll flow on top of this hook - can
 * force a re-check on demand (after logout, or from a fallback poll).
 */
export function useApiAuthStatus() {
  const [isApiAuthenticated, setIsApiAuthenticated] = useState<boolean | null>(null);

  const checkProviderAuth = useCallback(async () => {
    try {
      const status = await getAuthStatus();
      setIsApiAuthenticated(status.authenticated);
    } catch {
      setIsApiAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkProviderAuth();

    const handleMessage = (event: MessageEvent) => {
      // Reject postMessages from any other origin before trusting
      // event.data at all - without this, any page holding a reference to
      // this window could inject fake tokens for us to persist and trust.
      if (event.origin !== window.location.origin) return;
      console.log("[Auth] Received message:", event.data?.type);
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        if (event.data.tokens) {
          console.log("[Auth] Tokens received safely");
          persistTokens(event.data.tokens);
        } else {
          console.error("[Auth] No tokens contained in postMessage!");
        }
        checkProviderAuth();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [checkProviderAuth]);

  return { isApiAuthenticated, checkProviderAuth };
}
