import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { errorTextFrom, fetchWithRetry, getBaseUrl } from '@/services/google-api';
import { postJson } from '@/services/apiClient';
import { useAuth } from './AuthContext';

import { Config } from '@/types';

interface ConfigContextType {
  config: Config;
  loading: boolean;
  /** Saves the shared Config (Full Administrators only - the server refuses anyone else). */
  saveConfig: (newConfig: Config) => Promise<void>;
  /** Re-reads the Config, quietly (live refresh after someone else saved it). */
  reloadConfig: () => Promise<void>;
}

const defaultConfig: Config = {
  auctionItemsSpreadsheetId: "",
  auctionTicketsSpreadsheetId: "",
  bidManagementSpreadsheetId: "",
  bidderNumbersSheet: "Bidder-Numbers",
  bidManagementSheet: "Bid-Management",
  receiptFolderId: "",
  forPrintFolderId: "",
  ornsLogoId: "",
  ticketPrice: "35",
  ticketPriceFromWebsiteAt: "",
  auctionItemsScriptId: "",
  auctionTicketsScriptId: "",
  bidManagementScriptId: "",
  bugReportsSpreadsheetId: "",
  bugReportsFolderId: "",
  paypalIsSandbox: true,
};

/**
 * Copies only the keys Config declares, over the defaults, so a missing
 * field gets its default (not `undefined`, which trips Base UI's
 * uncontrolled-to-controlled warning) and nothing extra rides along.
 */
function toConfig(raw: Record<string, unknown>): Config {
  const config = { ...defaultConfig };
  (Object.keys(defaultConfig) as (keyof Config)[]).forEach((key) => {
    if (raw[key] !== undefined) (config as any)[key] = raw[key];
  });
  return config;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

/**
 * The auction's shared Config (which spreadsheets and folders this year
 * uses, ticket price, PayPal mode), read from the server
 * (GET /api/config, server/services/configService.ts) as soon as someone
 * is signed in - staff of every role and volunteers alike, with no
 * separate sign-in. Saving goes back through the server.
 */
export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth();
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/config`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorTextFrom(data, `status ${res.status}`));
      setConfig(toConfig(data));
    } catch (e: any) {
      console.error("Couldn't load the auction settings:", e);
      if (!options?.silent) toast.error("Couldn't load the auction's settings. Reload the page to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated === true) fetchConfig();
    else if (authenticated === false) setLoading(false);
  }, [authenticated, fetchConfig]);

  const reloadConfig = useCallback(() => fetchConfig({ silent: true }), [fetchConfig]);

  const saveConfig = async (newConfig: Config) => {
    try {
      const saved = await postJson<Record<string, unknown>>("/api/config", newConfig, "Couldn't save the settings");
      setConfig(toConfig(saved));
      toast.success("Settings saved for everyone.");
    } catch (error: any) {
      console.error("Error saving config:", error);
      toast.error(`Error saving settings: ${error.message}`);
      throw error;
    }
  };

  return (
    <ConfigContext.Provider value={{ config, loading, saveConfig, reloadConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
