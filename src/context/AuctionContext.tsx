import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "./ConfigContext";
import { useAuth } from "./AuthContext";
import { Bidder, AuctionItem, Attendee } from "@/types";
import type { BidGridWin } from "@/lib/bidGridParsing";
import { useBiddersData } from "@/hooks/useBiddersData";
import { useAuctionItems } from "@/hooks/useAuctionItems";
import { useAttendeesData } from "@/hooks/useAttendeesData";
import { useWinnersData } from "@/hooks/useWinnersData";
import { useAuctionStatusData } from "@/hooks/useAuctionStatusData";
import { AuctionState } from "@/lib/auctionState";
import { useChangeFeed } from "@/hooks/useChangeFeed";
import { postJson } from "@/services/apiClient";

interface AuctionContextType {
  bidders: Bidder[];
  items: AuctionItem[];
  attendees: Attendee[];
  winners: Record<string, string>;
  totalRaised: number;
  /** The Bid-Management grid's wins, as last read (Checkout's source). */
  bidGridWins: BidGridWin[];
  /** Re-reads the Bid-Management grid; resolves false if the read failed. */
  fetchWinners: () => Promise<boolean>;
  loading: boolean;
  attendeesLoading: boolean;
  fetchBidders: () => Promise<void>;
  fetchAttendees: () => Promise<void>;
  fetchAllData: () => Promise<void>;
  checkInBidder: (bidder: Bidder) => Promise<void>;
  markBidderAsProxy: (bidder: Bidder) => Promise<void>;
  setAttendees: React.Dispatch<React.SetStateAction<Attendee[]>>;
  addAttendee: (sheet: string, data: string[]) => Promise<void>;
  removeAttendee: (attendee: Attendee) => Promise<void>;
  recordWinningBid: (bidderId: string, itemId: string, price: number) => Promise<string | void>;
  auctionState: AuctionState;
  isAuctionClosed: boolean;
  /** null while unknown. */
  isBidManagementSetUp: boolean | null;
  goLive: () => Promise<void>;
  /**
   * Live refresh: goes up each time data changed elsewhere (another
   * person, another tab, an Undo) was reloaded. Pages with their own reads
   * re-read when it changes; `lastChangedKeys` says what changed (spreadsheet
   * IDs or "action-history"; "*" = everything).
   */
  dataVersion: number;
  lastChangedKeys: string[];
  /** Checks for changes now instead of on the next tick (after an Undo). */
  checkForChanges: () => Promise<void>;
  closeAuction: () => Promise<void>;
}

const AuctionContext = createContext<AuctionContextType | undefined>(undefined);

export function AuctionProvider({ children }: { children: React.ReactNode }) {
  const { config, reloadConfig } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const ticketsSpreadsheetId = config.auctionTicketsSpreadsheetId;

  const { authenticated: isApiAuthenticated, user } = useAuth();

  const biddersData = useBiddersData(spreadsheetId, config.bidderNumbersSheet);
  // Items live in the separate Auction Items spreadsheet, not a copy synced
  // into Bid Management - see docs/agents/CHANGELOG.md's Code
  // Hardening item #1 / CHANGELOG.md. useAuctionItems already implements
  // "fetch live, full-fidelity items from a spreadsheet ID" (it's what the
  // top-level Auction Items workflow uses too), and returns the same
  // AuctionItem[] shape the old useItemsData did.
  const itemsData = useAuctionItems(config.auctionItemsSpreadsheetId);
  const attendeesData = useAttendeesData(ticketsSpreadsheetId, user?.role === "volunteer");
  const winnersData = useWinnersData(spreadsheetId, biddersData.bidders, itemsData.items, config.bidManagementSheet, config.bidderNumbersSheet, config.auctionItemsSpreadsheetId);
  const auctionStatusData = useAuctionStatusData(spreadsheetId, config.bidManagementSheet, config.bidderNumbersSheet);

  const { fetchBidders, setLoading } = biddersData;
  const { refresh: refreshItems } = itemsData;
  const { fetchAttendees } = attendeesData;
  const { fetchAuctionStatus, fetchSetupStatus, requestCloseAuction } = auctionStatusData;

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchBidders(), refreshItems(), fetchAttendees(), fetchAuctionStatus(), fetchSetupStatus()]);
  }, [setLoading, fetchBidders, refreshItems, fetchAttendees, fetchAuctionStatus, fetchSetupStatus]);

  // Live refresh (useChangeFeed.ts): when another person, another tab or
  // an Undo changes a spreadsheet this page shows, reload just that data -
  // quietly, without loading spinners.
  const [dataVersion, setDataVersion] = useState(0);
  const [lastChangedKeys, setLastChangedKeys] = useState<string[]>([]);
  const fetchWinnersRef = useRef(winnersData.fetchWinners);
  fetchWinnersRef.current = winnersData.fetchWinners;
  const onRemoteChange = useCallback(async (changed: Set<string>, reset: boolean) => {
    const touched = (id: string) => !!id && (reset || changed.has(id));
    const reloads: Promise<unknown>[] = [];
    if (touched(spreadsheetId)) {
      reloads.push(
        fetchBidders({ silent: true }).then(() => fetchWinnersRef.current()),
        fetchAuctionStatus(),
        fetchSetupStatus()
      );
    }
    if (touched(config.auctionItemsSpreadsheetId)) reloads.push(refreshItems({ silent: true }));
    if (touched(ticketsSpreadsheetId)) reloads.push(fetchAttendees({ silent: true }));
    // A Full Administrator saved the Config: pick up the new IDs (the data
    // effects below then reload anything that now points elsewhere).
    if (touched("config")) reloads.push(reloadConfig());
    await Promise.all(reloads);
    setLastChangedKeys(reset ? ["*"] : [...changed]);
    setDataVersion((v) => v + 1);
  }, [spreadsheetId, config.auctionItemsSpreadsheetId, ticketsSpreadsheetId, fetchBidders, fetchAuctionStatus, fetchSetupStatus, refreshItems, fetchAttendees, reloadConfig]);
  const checkForChanges = useChangeFeed(isApiAuthenticated === true, onRemoteChange, user?.email);

  const goLive = useCallback(async () => {
    await auctionStatusData.requestGoLive();
  }, [auctionStatusData.requestGoLive]);

  const closeAuction = useCallback(async () => {
    const succeeded = await requestCloseAuction();
    if (succeeded) {
      fetchAllData();
    }
  }, [requestCloseAuction, fetchAllData]);

  useEffect(() => {
    // Only attempt to fetch auction data when authenticated
    if (isApiAuthenticated && spreadsheetId) {
      fetchAllData();
    }
  }, [isApiAuthenticated, spreadsheetId, fetchAllData]);

  // Bidders follow their tickets (server/services/bidderTicketSync.ts): on
  // load, have the server bring any renamed ticket across, then show it.
  // Staff only - volunteers' checkout and receipts run the same check on
  // the server.
  const isStaff = !!user && user.role !== "volunteer";
  useEffect(() => {
    if (!isApiAuthenticated || !isStaff || !spreadsheetId || !ticketsSpreadsheetId) return;
    postJson<{ renamed: number; added: number }>("/api/bidders/sync-from-tickets", {}, "Couldn't check bidders against the tickets")
      .then(({ renamed, added }) => { if (renamed + added > 0) fetchBidders({ silent: true }); })
      .catch((e) => console.warn(e.message));
  }, [isApiAuthenticated, isStaff, spreadsheetId, ticketsSpreadsheetId, fetchBidders]);

  useEffect(() => {
    if (isApiAuthenticated && ticketsSpreadsheetId) {
      fetchAttendees();
    }
  }, [isApiAuthenticated, ticketsSpreadsheetId, fetchAttendees]);

  useEffect(() => {
    if (isApiAuthenticated && biddersData.bidders.length > 0) {
      winnersData.fetchWinners();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApiAuthenticated, biddersData.bidders.length, winnersData.fetchWinners]);

  const value: AuctionContextType = {
    bidders: biddersData.bidders,
    items: itemsData.items,
    attendees: attendeesData.attendees,
    winners: winnersData.winners,
    totalRaised: winnersData.totalRaised,
    bidGridWins: winnersData.bidGridWins,
    fetchWinners: winnersData.fetchWinners,
    loading: biddersData.loading,
    attendeesLoading: attendeesData.loading,
    fetchBidders: biddersData.fetchBidders,
    fetchAttendees: attendeesData.fetchAttendees,
    fetchAllData,
    checkInBidder: biddersData.checkInBidder,
    markBidderAsProxy: biddersData.markBidderAsProxy,
    setAttendees: attendeesData.setAttendees,
    addAttendee: attendeesData.addAttendee,
    removeAttendee: attendeesData.removeAttendee,
    recordWinningBid: winnersData.recordWinningBid,
    auctionState: auctionStatusData.auctionState,
    isAuctionClosed: auctionStatusData.isAuctionClosed,
    isBidManagementSetUp: auctionStatusData.isBidManagementSetUp,
    goLive,
    dataVersion,
    lastChangedKeys,
    checkForChanges,
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
