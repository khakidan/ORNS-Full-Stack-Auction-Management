import React, { createContext, useContext, useCallback, useEffect } from "react";
import { useConfig } from "./ConfigContext";
import { Bidder, AuctionItem, Attendee } from "@/types";
import { useApiAuthStatus } from "@/hooks/useApiAuthStatus";
import { useBiddersData } from "@/hooks/useBiddersData";
import { useItemsData } from "@/hooks/useItemsData";
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
  fetchBidders: () => Promise<void>;
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

  const { isApiAuthenticated } = useApiAuthStatus();

  const biddersData = useBiddersData(spreadsheetId, config.bidderNumbersSheet);
  const itemsData = useItemsData(spreadsheetId, config.auctionItemsSheet);
  const attendeesData = useAttendeesData(ticketsSpreadsheetId);
  const winnersData = useWinnersData(spreadsheetId, biddersData.bidders, config.bidManagementSheet, config.bidderNumbersSheet);
  const auctionStatusData = useAuctionStatusData(spreadsheetId, config.bidManagementSheet, config.bidderNumbersSheet);

  const { fetchBidders, setLoading } = biddersData;
  const { fetchItems } = itemsData;
  const { fetchAttendees } = attendeesData;
  const { fetchAuctionStatus, requestCloseAuction } = auctionStatusData;

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchBidders(), fetchItems(), fetchAttendees(), fetchAuctionStatus()]);
  }, [setLoading, fetchBidders, fetchItems, fetchAttendees, fetchAuctionStatus]);

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
