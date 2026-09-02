import React, { createContext, useContext, useState, useEffect } from 'react';
import { getFirebase } from '@/services/firebase';
import type { User } from 'firebase/auth';
import { toast } from 'sonner';

import { Config } from '@/types';

interface ConfigContextType {
  config: Config;
  loading: boolean;
  saveConfig: (newConfig: Config) => Promise<void>;
  firebaseUser: User | null;
  loginToFirebase: () => Promise<void>;
}

const defaultConfig: Config = {
  auctionItemsSpreadsheetId: localStorage.getItem("auctionItemsSpreadsheetId") || import.meta.env.VITE_AUCTION_ITEMS_SPREADSHEET_ID || "",
  auctionTicketsSpreadsheetId: localStorage.getItem("auctionTicketsSpreadsheetId") || import.meta.env.VITE_AUCTION_TICKETS_SPREADSHEET_ID || "",
  bidManagementSpreadsheetId: localStorage.getItem("bidManagementSpreadsheetId") || localStorage.getItem("spreadsheetId") || import.meta.env.VITE_BID_MANAGEMENT_SPREADSHEET_ID || "",
  bidderNumbersSheet: localStorage.getItem("bidderNumbersSheet") || import.meta.env.VITE_BIDDER_NUMBERS_SHEET || "Bidder-Numbers",
  auctionItemsSheet: localStorage.getItem("auctionItemsSheet") || import.meta.env.VITE_AUCTION_ITEMS_SHEET || "Auction-Items",
  bidManagementSheet: localStorage.getItem("bidManagementSheet") || import.meta.env.VITE_BID_MANAGEMENT_SHEET || "Bid-Management",
  receiptFolderId: localStorage.getItem("receiptFolderId") || import.meta.env.VITE_RECEIPT_FOLDER_ID || "",
  forPrintFolderId: localStorage.getItem("forPrintFolderId") || import.meta.env.VITE_FOR_PRINT_FOLDER_ID || "",
  ornsLogoId: localStorage.getItem("ornsLogoId") || import.meta.env.VITE_ORNS_LOGO_ID || "",
  ticketPrice: localStorage.getItem("ticketPrice") || import.meta.env.VITE_TICKET_PRICE || "35",
  auctionItemsScriptId: localStorage.getItem("auctionItemsScriptId") || import.meta.env.VITE_AUCTION_ITEMS_SCRIPT_ID || "",
  auctionTicketsScriptId: localStorage.getItem("auctionTicketsScriptId") || import.meta.env.VITE_AUCTION_TICKETS_SCRIPT_ID || "",
  bidManagementScriptId: localStorage.getItem("bidManagementScriptId") || localStorage.getItem("googleScriptId") || import.meta.env.VITE_BID_MANAGEMENT_SCRIPT_ID || "",
};

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    getFirebase().then(({ auth, db, onAuthStateChanged, onSnapshot, doc }) => {
      if (cancelled) return;
      unsubscribe = onAuthStateChanged(auth, (user) => {
        setFirebaseUser(user);
        if (user) {
          // Subscribe to global config
          const unsubConfig = onSnapshot(doc(db, 'settings', 'global'), (docSnap) => {
            if (docSnap.exists()) {
              const data = docSnap.data() as Config;
              setConfig(data);

              // Mirror to localStorage for components yet to be migrated
              Object.entries(data).forEach(([key, value]) => {
                localStorage.setItem(key, value as string);
              });
              // Legacy key
              localStorage.setItem("spreadsheetId", data.bidManagementSpreadsheetId);
              localStorage.setItem("googleScriptId", data.bidManagementScriptId);
            }
            setLoading(false);
          }, (error) => {
            console.error("Firestore Error:", error);
            if (error.code === 'permission-denied') {
              toast.error("Permission denied: Sync is only available for @orns.org users.");
            }
            setLoading(false);
          });
          return () => unsubConfig();
        } else {
          setLoading(false);
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const loginToFirebase = async () => {
    const { auth, GoogleAuthProvider, signInWithPopup, signOut } = await getFirebase();
    const provider = new GoogleAuthProvider();
    // Suggest domain restriction to Google
    provider.setCustomParameters({
      hd: 'orns.org',
      prompt: 'select_account'
    });

    try {
      const result = await signInWithPopup(auth, provider);
      const email = result.user.email;
      if (email && !email.endsWith('@orns.org')) {
        toast.error("Access restricted: Please use an @orns.org account.");
        await signOut(auth);
      }
    } catch (error) {
      console.error("Firebase Login Error:", error);
      toast.error("Failed to sign in to sync service.");
    }
  };

  const saveConfig = async (newConfig: Config) => {
    if (!firebaseUser) {
      toast.error("You must be signed in to save shared settings.");
      return;
    }

    try {
      const { db, doc, setDoc, serverTimestamp } = await getFirebase();
      await setDoc(doc(db, 'settings', 'global'), {
        ...newConfig,
        updatedAt: serverTimestamp(),
        updatedBy: firebaseUser.email
      });
      setConfig(newConfig);
      toast.success("Settings saved and synced across devices!");
    } catch (error: any) {
      console.error("Error saving config:", error);
      toast.error(`Error saving settings: ${error.message}`);
      throw error;
    }
  };

  return (
    <ConfigContext.Provider value={{ config, loading, saveConfig, firebaseUser, loginToFirebase }}>
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
