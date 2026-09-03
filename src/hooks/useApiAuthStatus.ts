import { useCallback, useEffect, useState } from "react";
import { getAuthStatus } from "@/services/google-api";

/**
 * Tracks whether the backend's Google API client is authenticated, and
 * listens for the OAuth popup's `postMessage` success signal (persisting
 * any tokens it carries) to re-check status without a full page reload.
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
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        if (event.data.tokens) {
          localStorage.setItem('google_tokens', JSON.stringify(event.data.tokens));
        }
        checkProviderAuth();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [checkProviderAuth]);

  return isApiAuthenticated;
}
