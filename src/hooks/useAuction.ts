// src/hooks/useAuction.ts
import { useState, useCallback, useEffect } from "react";
import { getSheetData, updateSheetData, appendSheetData } from "@/lib/google-api";
import { toast } from "sonner";

export interface Bidder {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  checkedIn: boolean;
  isProxy: boolean;
  checkedOut: boolean;
  paid: boolean;
  rowIndex: number;
}

export interface AuctionItem {
  id: string;
  name: string;
  type?: string;
  description?: string;
}

export function useAuction() {
  const spreadsheetId = localStorage.getItem("spreadsheetId") || "";
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [winners, setWinners] = useState<Record<string, string>>({}); // itemId -> bidderName
  const [totalRaised, setTotalRaised] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchBidders = useCallback(async () => {
    if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) return;
    setLoading(true);
    try {
      const sheetName = localStorage.getItem("bidderNumbersSheet") || "Bidder-Numbers";
      const data = await getSheetData(spreadsheetId, `${sheetName}!A:H`);

      if (data.values?.length > 1) {
        const biddersList: Bidder[] = data.values.slice(1).map((row: any[], idx: number) => ({
          id: row[0]?.toString() || "",
          firstName: row[1]?.toString() || "",
          lastName: row[2]?.toString() || "",
          email: row[3]?.toString() || "",
          checkedIn: row[4] === true || row[4] === "TRUE",
          isProxy: row[5] === true || row[5] === "TRUE",
          checkedOut: row[6] === true || row[6] === "TRUE",
          paid: row[7] === true || row[7] === "TRUE",
          rowIndex: idx + 2,
        })).filter(b => b.id);
        setBidders(biddersList);
      }
    } catch (e) {
      toast.error("Failed to load bidders");
    } finally {
      setLoading(false);
    }
  }, [spreadsheetId]);

  const fetchItems = useCallback(async () => {
    if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) return;
    try {
      const sheetName = localStorage.getItem("auctionItemsSheet") || "Auction-Items";
      const data = await getSheetData(spreadsheetId, `${sheetName}!A:C`);
      if (data.values?.length > 1) {
        const itemsList = data.values.slice(1).map((row: any[]) => ({
          id: row[0]?.toString() || "",
          name: row[1]?.toString() || "",
          type: row[2]?.toString() || "",
        }));
        setItems(itemsList);
      }
    } catch (e) {
      console.error(e);
    }
  }, [spreadsheetId]);

  const fetchWinners = useCallback(async () => {
    if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE") || bidders.length === 0) return;
    try {
      const sheetName = localStorage.getItem("bidManagementSheet") || "Bid-Management";
      const data = await getSheetData(spreadsheetId, `${sheetName}!A:ZZ`); // Fetch wide range to catch all bidders
      
      if (!data.values || data.values.length < 4) return;

      const header = data.values[0];
      const newWinners: Record<string, string> = {};
      let total = 0;

      // Scan each bidder column (A, C, E...)
      for (let j = 0; j < header.length; j += 2) {
        const bidderId = header[j]?.toString();
        if (!bidderId) continue;

        const bidder = bidders.find(b => b.id === bidderId);
        const bidderName = bidder ? `${bidder.firstName} ${bidder.lastName}` : `Bidder ${bidderId}`;

        // Rows start at row 4 (index 3)
        for (let i = 3; i < data.values.length; i++) {
          const row = data.values[i];
          if (row && row[j]) {
            const itemId = row[j].toString();
            newWinners[itemId] = bidderName;
            
            // Sum prices (stored in column j+1)
            const price = parseFloat(row[j + 1]?.toString().replace(/[^0-9.]/g, "") || "0");
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
  }, [spreadsheetId, bidders]);

  const checkInBidder = async (bidder: Bidder) => {
    if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) return;
    try {
      const sheetName = localStorage.getItem("bidderNumbersSheet") || "Bidder-Numbers";
      const data = await getSheetData(spreadsheetId, `${sheetName}!A:A`);
      const rowIndex = data.values.findIndex((row: any) => row[0]?.toString() === bidder.id) + 1;
      
      if (rowIndex > 1) {
        await updateSheetData(spreadsheetId, `${sheetName}!E${rowIndex}`, [[true]]);
        setBidders(prev => prev.map(b => b.id === bidder.id ? { ...b, checkedIn: true } : b));
        toast.success(`${bidder.firstName} ${bidder.lastName} checked in`);
      } else {
        toast.error("Bidder not found in sheet.");
      }
    } catch (e) {
      toast.error("Failed to check in bidder.");
    }
  };

  useEffect(() => {
    if (spreadsheetId) {
      fetchBidders();
      fetchItems();
    }
  }, [spreadsheetId, fetchBidders, fetchItems]);

  useEffect(() => {
    if (bidders.length > 0) {
      fetchWinners();
    }
  }, [bidders.length, fetchWinners]);

  return { bidders, items, winners, totalRaised, loading, fetchBidders, fetchItems, fetchWinners, checkInBidder };
}