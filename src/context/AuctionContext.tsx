import React, { createContext, useContext, useCallback, useEffect } from "react";
import { useConfig } from "./ConfigContext";
import { useAuth } from "./AuthContext";
import { Bidder, AuctionItem, Attendee } from "@/types";
import { useBiddersData } from "@/hooks/useBiddersData";
import { useAuctionItems } from "@/hooks/useAuctionItems";
import { useAttendeesData } from "@/hooks/useAttendeesData";
import { useWinnersData } from "@/hooks/useWinnersData";
import { useAuctionStatusData } from "@/hooks/useAuctionStatusData";

interface AuctionContextType {
  bidders: Bidder[];
  items: AuctionItem[];
  attendees: Attendee[];
  winners: Record<string, string>;
  totalRaised: number;
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
  isAuctionClosed: boolean;
  closeAuction: () => Promise<void>;
}

const AuctionContext = createContext<AuctionContextType | undefined>(undefined);

export function AuctionProvider({ children }: { children: React.ReactNode }) {
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const ticketsSpreadsheetId = config.auctionTicketsSpreadsheetId;

  const { authenticated: isApiAuthenticated } = useAuth();

  const biddersData = useBiddersData(spreadsheetId, config.bidderNumbersSheet);
  // Items live in the separate Auction Items spreadsheet, not a copy synced
  // into Bid Management - see docs/agents/refactor-opportunities.md's Code
  // Hardening item #1 / CHANGELOG.md. useAuctionItems already implements
  // "fetch live, full-fidelity items from a spreadsheet ID" (it's what the
  // top-level Auction Items workflow uses too), and returns the same
  // AuctionItem[] shape the old useItemsData did.
  const itemsData = useAuctionItems(config.auctionItemsSpreadsheetId);
  const attendeesData = useAttendeesData(ticketsSpreadsheetId);
  const winnersData = useWinnersData(spreadsheetId, biddersData.bidders, itemsData.items, config.bidManagementSheet, config.bidderNumbersSheet, config.auctionItemsSpreadsheetId);
  const auctionStatusData = useAuctionStatusData(spreadsheetId, config.bidManagementSheet, config.bidderNumbersSheet);

  const { fetchBidders, setLoading } = biddersData;
  const { refresh: refreshItems } = itemsData;
  const { fetchAttendees } = attendeesData;
  const { fetchAuctionStatus, requestCloseAuction } = auctionStatusData;

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchBidders(), refreshItems(), fetchAttendees(), fetchAuctionStatus()]);
  }, [setLoading, fetchBidders, refreshItems, fetchAttendees, fetchAuctionStatus]);

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
    isAuctionClosed: auctionStatusData.isAuctionClosed,
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
