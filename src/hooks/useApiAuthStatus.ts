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
