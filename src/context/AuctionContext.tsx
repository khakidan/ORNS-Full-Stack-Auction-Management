import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { getSheetData, updateSheetData, clearSheetData, fetchWithRetry, getBaseUrl, appendSheetData, getAuthStatus } from "@/lib/google-api";
import { toast } from "sonner";
import { useConfig } from "./ConfigContext";
import { Bidder, AuctionItem, Attendee, Guest } from "@/types";

interface AuctionContextType {
  bidders: Bidder[];
  items: AuctionItem[];
  attendees: Attendee[];
  winners: Record<string, string>;
  totalRaised: number;
  loading: boolean;
  fetchBidders: () => Promise<void>;
  fetchItems: () => Promise<void>;
  fetchWinners: () => Promise<void>;
  fetchAttendees: () => Promise<void>;
  fetchAllData: () => Promise<void>;
  checkInBidder: (bidder: Bidder) => Promise<void>;
  markBidderAsProxy: (bidder: Bidder) => Promise<void>;
  setAttendees: React.Dispatch<React.SetStateAction<Attendee[]>>;
  addAttendee: (sheet: string, data: any[]) => Promise<void>;
  removeAttendee: (attendee: Attendee) => Promise<void>;
  recordWinningBid: (bidderId: string, itemId: string, price: number) => Promise<void>;
  isAuctionClosed: boolean;
  closeAuction: () => Promise<void>;
}

const AuctionContext = createContext<AuctionContextType | undefined>(undefined);

export function AuctionProvider({ children }: { children: React.ReactNode }) {
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const ticketsSpreadsheetId = config.auctionTicketsSpreadsheetId;
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [totalRaised, setTotalRaised] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isAuctionClosed, setIsAuctionClosed] = useState(false);
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

  const fetchAuctionStatus = useCallback(async () => {
    if (!spreadsheetId) return;
    try {
      const data = await getSheetData(spreadsheetId, "Auction-Status!A2");
      if (data.values && data.values[0]) {
        const val = data.values[0][0];
        setIsAuctionClosed(val === false || val === "FALSE");
      }
    } catch (e) {
      console.error("Error fetching auction status:", e);
    }
  }, [spreadsheetId]);

  const closeAuction = async () => {
    if (!spreadsheetId) return;
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/auction/close-and-cleanup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId,
          bidderNumbersSheet: config.bidderNumbersSheet,
          bidManagementSheet: config.bidManagementSheet
        }),
        credentials: "include"
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to close auction and cleanup");
      }

      const data = await res.json();
      setIsAuctionClosed(true);
      toast.success("Auction closed successfully.");
      if (data.count > 0) {
        toast.info(`Automatically checked out ${data.count} non-winning bidders.`);
      }
      fetchAllData();
    } catch (e: any) {
      console.error("Error closing auction:", e);
      toast.error("Failed to close auction: " + e.message);
    }
  };

  const fetchBidders = useCallback(async () => {
    if (!spreadsheetId) return;
    setLoading(true);
    try {
      const sheetName = config.bidderNumbersSheet;
      const data = await getSheetData(spreadsheetId, `${sheetName}!A:H`);

      if (data && data.values?.length > 1) {
        const biddersList: Bidder[] = data.values.slice(1).map((row: string[], idx: number) => ({
          id: row[0]?.toString() || "",
          firstName: row[1]?.toString() || "",
          lastName: row[2]?.toString() || "",
          email: row[3]?.toString() || "",
          checkedIn: row[4] === "TRUE" || row[4] === "true",
          isProxy: row[5] === "TRUE" || row[5] === "true",
          checkedOut: row[6] === "TRUE" || row[6] === "true",
          paid: row[7] === "TRUE" || row[7] === "true",
          rowIndex: idx + 2,
        })).filter(b => b.id);
        setBidders(biddersList);
      } else {
        setBidders([]);
      }
    } catch (e) {
      console.error(e);
      setBidders([]);
    } finally {
      setLoading(false);
    }
  }, [spreadsheetId, config.bidderNumbersSheet]);

  const fetchItems = useCallback(async () => {
    if (!spreadsheetId) return;
    try {
      const sheetName = config.auctionItemsSheet;
      const data = await getSheetData(spreadsheetId, `${sheetName}!A:Z`);
      if (data && data.values?.length > 1) {
        const headers = data.values[0].map((h: string) => (h || "").toString().toLowerCase().trim());
        
        const getCol = (names: string[], defaultIdx: number) => {
          const idx = headers.findIndex((h: string) => names.some(n => h === n || h.includes(n)));
          return idx !== -1 ? idx : defaultIdx;
        };

        const idIdx = getCol(["item number", "number", "id"], 0);
        const categoryIdx = getCol(["category"], 1);
        const nameIdx = getCol(["item name", "name"], 2);
        const descIdx = getCol(["description", "desc"], 3);
        const valIdx = getCol(["value", "fair market"], 4);
        const openIdx = getCol(["opening bid", "starting bid"], 5);
        const minIdx = getCol(["min raise", "increment"], 6);
        const donorIdx = getCol(["donor"], 7);
        const typeIdx = getCol(["item type", "type"], 8);
        const statusIdx = getCol(["status"], 9);
        const bundleIdIdx = getCol(["bundle id", "bundled with"], 10);
        const bundledIdx = getCol(["bundled datetime", "bundled"], 11);

        const itemsList = data.values.slice(1).map((row: string[], i: number) => ({
          id: row[idIdx]?.toString() || "",
          category: row[categoryIdx]?.toString() || "",
          name: row[nameIdx]?.toString() || "",
          description: row[descIdx]?.toString() || "",
          value: row[valIdx]?.toString() || "",
          openingBid: row[openIdx]?.toString() || "",
          minRaise: row[minIdx]?.toString() || "",
          donor: row[donorIdx]?.toString() || "",
          itemType: row[typeIdx]?.toString() || "",
          status: row[statusIdx]?.toString() || "Active",
          bundleId: row[bundleIdIdx]?.toString() || "",
          bundledDateTime: row[bundledIdx]?.toString() || "",
          rowIndex: i + 2
        })).filter((item: any) => item.id || item.name);
        setItems(itemsList);
      } else {
        setItems([]);
      }
    } catch (e) {
      console.error(e);
      setItems([]);
    }
  }, [spreadsheetId, config.auctionItemsSheet]);

  const recordWinningBid = async (bidderId: string, itemId: string, price: number) => {
    if (!spreadsheetId) {
      throw new Error("Spreadsheet ID not configured");
    }

    // 1. Store previous state
    const previousWinners = { ...winners };
    const previousTotal = totalRaised;
    
    // Find bidder name for optimistic UI
    const bidder = bidders.find(b => b.id === bidderId);
    const bidderName = bidder ? `${bidder.firstName} ${bidder.lastName}` : `Bidder ${bidderId}`;

    // 2. Optimistic Update
    setWinners(prev => ({ ...prev, [itemId]: bidderName }));
    setTotalRaised(prev => prev + price);

    // 3. Background Sync
    const idempotencyKey = crypto.randomUUID();
    
    fetchWithRetry(`${getBaseUrl()}/api/auction/record-winning-bid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bidderId,
        itemId,
        price,
        spreadsheetId,
        bidManagementSheet: config.bidManagementSheet,
        bidderNumbersSheet: config.bidderNumbersSheet,
        idempotencyKey
      }),
      credentials: "include"
    })
      .then(async res => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to sync bid");
        }
        return res.json();
      })
      .then((data) => {
        toast.success(`Synced bid: ${bidderName} — ${itemId} — $${price}`);
        if (data.followUpAdded) {
          toast.info("Bidder was already checked out. Added to Follow-Up sheet.", { duration: 5000 });
        }
      })
      .catch(e => {
        console.error("Bid sync failed", e);
        // 4. Rollback
        setWinners(previousWinners);
        setTotalRaised(previousTotal);
        toast.error(`Failed to sync updates—retrying... local state reverted.`);
      });
  };

  const fetchAttendees = useCallback(async () => {
    if (!ticketsSpreadsheetId) return;
    try {
      const sheetsToFetch = ["tickets", "staff tickets", "sponsor tickets"];
      let allAttendees: Attendee[] = [];
      
      for (const sheetName of sheetsToFetch) {
        try {
          const data = await getSheetData(ticketsSpreadsheetId, `${sheetName}!A:Z`);
          if (data.values && data.values.length > 1) {
            const rows = data.values.slice(1).map((row: string[], i: number) => {
              const guests: Guest[] = [];
              const isGeneral = sheetName === 'tickets';

              let g1own = '', g2f = row[10], g2l = row[11], g2e = row[12], g2own = '';
              let g3f = row[13], g3l = row[14], g3e = row[15], g3own = '';
              let pm = row[16], ps = row[17], tp = row[18];

              if (isGeneral) {
                g1own = row[10];
                g2f = row[11]; g2l = row[12]; g2e = row[13]; g2own = row[14];
                g3f = row[15]; g3l = row[16]; g3e = row[17]; g3own = row[18];
                pm = row[19]; ps = row[20]; tp = row[21];
              }

              if (row[7] || row[8] || row[9]) guests.push({ name: `${row[7] || ''} ${row[8] || ''}`.trim(), email: row[9]?.toString() || '', guestIndex: 1, ownBidderNumber: g1own?.toString() || '' });
              if (g2f || g2l || g2e) guests.push({ name: `${g2f || ''} ${g2l || ''}`.trim(), email: g2e?.toString() || '', guestIndex: 2, ownBidderNumber: g2own?.toString() || '' });
              if (g3f || g3l || g3e) guests.push({ name: `${g3f || ''} ${g3l || ''}`.trim(), email: g3e?.toString() || '', guestIndex: 3, ownBidderNumber: g3own?.toString() || '' });

              return {
                id: `${sheetName}-${i}`,
                sheet: sheetName,
                rowIndex: i + 2,
                firstName: row[0]?.toString() || "",
                lastName: row[1]?.toString() || "",
                email: row[2]?.toString() || "",
                phone: row[3]?.toString() || "",
                ticketsPurchased: row[4]?.toString() || "0",
                hasGuests: row[5]?.toString() || "",
                guestsInfo: guests,
                paymentMethod: isGeneral ? (pm?.toString() || "") : "Comp",
                paymentStatus: isGeneral ? (ps?.toString() || "") : "Paid",
                totalPaid: isGeneral ? (tp?.toString() || "") : "$0"
              };
            }).filter((a: Attendee) => a.firstName || a.lastName);
            allAttendees = [...allAttendees, ...rows];
          }
        } catch (e) {
          console.error(`Could not fetch ${sheetName}`, e);
        }
      }
      
      setAttendees(allAttendees);
    } catch (e) {
      console.error(e);
    }
  }, [ticketsSpreadsheetId]);

  const fetchWinners = useCallback(async () => {
    if (!spreadsheetId || bidders.length === 0) return;
    try {
      const sheetName = config.bidManagementSheet;
      const data = await getSheetData(spreadsheetId, `${sheetName}!A:ZZ`);
      
      if (!data || !data.values || data.values.length < 4) {
        setWinners({});
        setTotalRaised(0);
        return;
      }

      const header = data.values[0];
      const newWinners: Record<string, string> = {};
      let total = 0;

      // Bidder cache for faster lookup
      const bidderCache = new Map(bidders.map(b => [b.id, b]));

      // Column pair loop
      for (let j = 0; j < header.length; j += 2) {
        const bidderId = header[j]?.toString();
        if (!bidderId) continue;

        const bidder = bidderCache.get(bidderId);
        const bidderName = bidder ? `${bidder.firstName} ${bidder.lastName}` : `Bidder ${bidderId}`;

        for (let i = 3; i < data.values.length; i++) {
          const row = data.values[i];
          if (row && row[j]) {
            const itemId = row[j].toString();
            newWinners[itemId] = bidderName;
            
            const priceVal = row[j + 1];
            const price = parseFloat(priceVal?.toString().replace(/[^0-9.]/g, "") || "0");
            if (!isNaN(price)) {
              total += price;
            }
          }
        }
      }
      setWinners(newWinners);
      setTotalRaised(total);
    } catch (e) {
      console.error("Error fetching winners:", e);
    }
  }, [spreadsheetId, bidders, config.bidManagementSheet]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchBidders(), fetchItems(), fetchAttendees(), fetchAuctionStatus()]);
  }, [fetchBidders, fetchItems, fetchAttendees, fetchAuctionStatus]);

  const checkInBidder = async (bidder: Bidder) => {
    if (!spreadsheetId) return;
    
    // 1. Store previous state for rollback
    const previousBidders = [...bidders];
    
    // 2. Optimistic Update (Immediate UI change)
    setBidders(prev => prev.map(b => b.id === bidder.id ? { ...b, checkedIn: true } : b));
    
    // 3. Background Sync
    const sheetName = config.bidderNumbersSheet;
    getSheetData(spreadsheetId, `${sheetName}!A:A`)
      .then(data => {
        const rowIndex = data.values.findIndex((row: any) => row[0]?.toString() === bidder.id) + 1;
        if (rowIndex > 1) {
          return updateSheetData(spreadsheetId, `${sheetName}!E${rowIndex}`, [[true]]);
        } else {
          throw new Error("Bidder not found in management sheet.");
        }
      })
      .then(() => toast.success(`${bidder.firstName} ${bidder.lastName} checked in (Synced)`))
      .catch(e => {
        // 4. Rollback on failure
        setBidders(previousBidders);
        toast.error(`Failed to sync updates—retrying... local state reverted.`);
      });
  };

  const markBidderAsProxy = async (bidder: Bidder) => {
    if (!spreadsheetId) return;

    // 1. Store previous state for rollback
    const previousBidders = [...bidders];
    
    // 2. Optimistic Update
    setBidders(prev => prev.map(b => b.id === bidder.id ? { ...b, isProxy: true } : b));

    // 3. Background Sync
    const sheetName = config.bidderNumbersSheet;
    getSheetData(spreadsheetId, `${sheetName}!A:A`)
      .then(data => {
        const rowIndex = data.values.findIndex((row: any) => row[0]?.toString() === bidder.id) + 1;
        if (rowIndex > 1) {
          return updateSheetData(spreadsheetId, `${sheetName}!F${rowIndex}`, [[true]]);
        } else {
          throw new Error("Bidder not found in sheet.");
        }
      })
      .then(() => toast.success(`${bidder.firstName} ${bidder.lastName} marked as Proxy Bidder`))
      .catch(err => {
        // 4. Rollback
        setBidders(previousBidders);
        toast.error("Failed to sync updates—retrying... local state reverted.");
      });
  };

  const addAttendee = async (sheetName: string, rowData: any[]) => {
    if (!ticketsSpreadsheetId) return;
    
    const tempId = `temp-${Date.now()}`;
    const newAttendee: Attendee = {
      id: tempId,
      sheet: sheetName,
      rowIndex: -1, // Temporary
      firstName: rowData[0]?.toString() || "",
      lastName: rowData[1]?.toString() || "",
      email: rowData[2]?.toString() || "",
      phone: rowData[3]?.toString() || "",
      ticketsPurchased: rowData[4]?.toString() || "0",
      hasGuests: rowData[5]?.toString() || "",
      guestsInfo: [],
      paymentMethod: sheetName === 'tickets' ? (rowData[19]?.toString() || "") : "Comp",
      paymentStatus: sheetName === 'tickets' ? (rowData[20]?.toString() || "") : "Paid",
      totalPaid: sheetName === 'tickets' ? (rowData[21]?.toString() || "") : "$0"
    };

    // 1. Store previous state
    const previousAttendees = [...attendees];
    
    // 2. Optimistic Update
    setAttendees(prev => [...prev, newAttendee]);
    
    // 3. Background Sync
    appendSheetData(ticketsSpreadsheetId, `${sheetName}!A:A`, [rowData])
      .then(() => {
        // Re-fetch to get correct IDs/indices from the source of truth
        fetchAttendees();
        toast.success("Attendee record synced successfully");
      })
      .catch((e: any) => {
        // 4. Rollback
        setAttendees(previousAttendees);
        toast.error(`Failed to sync updates—retrying... local state reverted.`);
      });
  };

  const removeAttendee = async (attendee: Attendee) => {
    if (!ticketsSpreadsheetId) return;
    
    // 1. Store previous
    const previousAttendees = [...attendees];
    
    // 2. Optimistic Update
    setAttendees(prev => prev.filter(a => a.id !== attendee.id));
    
    // 3. Background Sync
    clearSheetData(ticketsSpreadsheetId, `${attendee.sheet}!A${attendee.rowIndex}:Z${attendee.rowIndex}`)
      .then(() => toast.success("Attendee record cleared in spreadsheet"))
      .catch((e: any) => {
        // 4. Rollback
        setAttendees(previousAttendees);
        toast.error(`Failed to sync updates—retrying... local state reverted.`);
      });
  };

  useEffect(() => {
    // Only attempt to fetch auction data when authenticated
    if (isApiAuthenticated && spreadsheetId) {
      fetchAllData();
    }
  }, [isApiAuthenticated, spreadsheetId, fetchAllData]);

  useEffect(() => {
    if (isApiAuthenticated && ticketsSpreadsheetId) {
      fetchAttendees();
    }
  }, [isApiAuthenticated, ticketsSpreadsheetId, fetchAttendees]);

  useEffect(() => {
    if (isApiAuthenticated && bidders.length > 0) {
      fetchWinners();
    }
  }, [isApiAuthenticated, bidders.length, fetchWinners]);

  const value = {
    bidders,
    items,
    attendees,
    winners,
    totalRaised,
    loading,
    fetchBidders,
    fetchItems,
    fetchWinners,
    fetchAttendees,
    fetchAllData,
    checkInBidder,
    markBidderAsProxy,
    setAttendees,
    addAttendee,
    removeAttendee,
    recordWinningBid,
    isAuctionClosed,
    closeAuction
  };

  return (
    <AuctionContext.Provider value={value}>
      {children}
    </AuctionContext.Provider>
  );
}

export function useAuction() {
  const context = useContext(AuctionContext);
  if (context === undefined) {
    throw new Error('useAuction must be used within an AuctionProvider');
  }
  return context;
}
