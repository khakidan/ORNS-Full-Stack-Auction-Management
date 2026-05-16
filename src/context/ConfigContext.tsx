import React, { createContext, useContext, useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { toast } from 'sonner';

export interface Config {
  auctionItemsSpreadsheetId: string;
  auctionTicketsSpreadsheetId: string;
  bidManagementSpreadsheetId: string;
  bidderNumbersSheet: string;
  auctionItemsSheet: string;
  bidManagementSheet: string;
  receiptFolderId: string;
  forPrintFolderId: string;
  ornsLogoId: string;
  ticketPrice: string;
  auctionItemsScriptId: string;
  auctionTicketsScriptId: string;
  bidManagementScriptId: string;
}

interface ConfigContextType {
  config: Config;
  loading: boolean;
  saveConfig: (newConfig: Config) => Promise<void>;
  firebaseUser: any;
  loginToFirebase: () => Promise<void>;
}

const defaultConfig: Config = {
  auctionItemsSpreadsheetId: localStorage.getItem("auctionItemsSpreadsheetId") || "",
  auctionTicketsSpreadsheetId: localStorage.getItem("auctionTicketsSpreadsheetId") || "",
  bidManagementSpreadsheetId: localStorage.getItem("bidManagementSpreadsheetId") || localStorage.getItem("spreadsheetId") || "",
  bidderNumbersSheet: localStorage.getItem("bidderNumbersSheet") || "Bidder-Numbers",
  auctionItemsSheet: localStorage.getItem("auctionItemsSheet") || "Auction-Items",
  bidManagementSheet: localStorage.getItem("bidManagementSheet") || "Bid-Management",
  receiptFolderId: localStorage.getItem("receiptFolderId") || "",
  forPrintFolderId: localStorage.getItem("forPrintFolderId") || "",
  ornsLogoId: localStorage.getItem("ornsLogoId") || "",
  ticketPrice: localStorage.getItem("ticketPrice") || "35",
  auctionItemsScriptId: localStorage.getItem("auctionItemsScriptId") || "",
  auctionTicketsScriptId: localStorage.getItem("auctionTicketsScriptId") || "",
  bidManagementScriptId: localStorage.getItem("bidManagementScriptId") || localStorage.getItem("googleScriptId") || "",
};

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
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

    return () => unsubscribe();
  }, []);

  const loginToFirebase = async () => {
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
