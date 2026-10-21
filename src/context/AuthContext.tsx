import React, { createContext, useContext } from "react";
import { useGoogleAuth } from "@/hooks/useGoogleAuth";

interface AuthContextType {
  authenticated: boolean | null;
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Single, app-wide instance of the Google auth status check + fallback
 * poll (useGoogleAuth.ts, itself built on
 * useApiAuthStatus.ts). Mounted once in main.tsx above both App.tsx (the
 * login gate) and AuctionProvider (which needs the same status to decide
 * when to start fetching auction data) - previously each called its own
 * copy of the underlying hook independently, so every OAuth completion
 * fired two separate /auth/status requests from two separate,
 * unsynchronized component-subtree instances. Sharing this one Provider
 * is what actually collapses that to one request; see CHANGELOG.md for
 * the earlier, code-only deduplication this builds on.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = useGoogleAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
