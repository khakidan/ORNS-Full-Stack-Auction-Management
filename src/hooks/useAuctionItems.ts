import { useState, useEffect, useCallback } from "react";
import { getSheetData } from "@/services/google-api";
import { AuctionItem } from "@/types";
import { getCategoryBase } from "@/lib/categoryHelpers";
import { toast } from "sonner";

export function useAuctionItems(spreadsheetId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesWithBase, setCategoriesWithBase] = useState<{name: string, base: number}[]>([]);
  const [valueCalculations, setValueCalculations] = useState<{minRange: number, minRaise: number}[]>([]);

  const fetchValueCalculations = useCallback(async () => {
    if (!spreadsheetId) return;
    try {
      const data = await getSheetData(spreadsheetId, "Value Calculations!A:B");
      if (data.values && data.values.length > 1) {
        const tiers = data.values.slice(1).map((row: any[]) => ({
          minRange: parseFloat(row[0]?.toString().replace(/[^0-9.-]+/g, "") || "0"),
          minRaise: parseFloat(row[1]?.toString().replace(/[^0-9.-]+/g, "") || "0")
        })).filter((t: any) => !isNaN(t.minRange) && !isNaN(t.minRaise) && t.minRaise > 0);
        setValueCalculations(tiers);
      }
    } catch (error) {
      console.error("Failed to fetch value calculations:", error);
    }
  }, [spreadsheetId]);

  const fetchCategories = useCallback(async () => {
    if (!spreadsheetId) return;
    try {
      const data = await getSheetData(spreadsheetId, "Categories!A:B");
      if (data.values && data.values.length > 1) {
        const catsWithBase = data.values.slice(1).map((row: any[]) => {
          const catName = row[0]?.toString() || "";
          const parsedBase = parseInt(row[1]?.toString() || "0", 10) || 0;
          return {
            name: catName,
            base: parsedBase || getCategoryBase(catName)
          };
        }).filter((c: any) => c.name);
        setCategoriesWithBase(catsWithBase);
        setCategories(catsWithBase.map((c: any) => c.name));
      }
    } catch (error) {
      console.error("Failed to fetch categories:", error);
    }
  }, [spreadsheetId]);

  const fetchData = useCallback(async () => {
    if (!spreadsheetId) {
      setLoading(false);
      return;
    }
    try {
      const data = await getSheetData(spreadsheetId, "Auction-Items!A:Z");
      if (data.values && data.values.length > 1) {
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

        const rows = data.values.slice(1).map((row: any[], index: number) => {
          return {
            rowIndex: index + 2, // 1 for 1-based index, +1 for header row
            id: row[idIdx]?.toString() || "",
            category: row[categoryIdx]?.toString() || "",
            name: row[nameIdx]?.toString() || "",
            description: row[descIdx]?.toString() || "",
            value: row[valIdx]?.toString() || "",
            openingBid: row[openIdx]?.toString() || "",
            minRaise: row[minIdx]?.toString() || "",
            donor: row[donorIdx]?.toString() || "",
            itemType: row[typeIdx]?.toString() || "",
            status: row[statusIdx]?.toString() || "",
            bundleId: row[bundleIdIdx]?.toString() || "",
            bundledDateTime: row[bundledIdx]?.toString() || "",
          };
        }).filter((item: any) => item.id && item.name);
        setItems(rows);
      }
    } catch (error) {
      console.error("Failed to fetch auction items:", error);
      toast.error("Failed to load auction items");
    } finally {
      setLoading(false);
    }
  }, [spreadsheetId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchData(), fetchCategories(), fetchValueCalculations()]);
    setLoading(false);
  }, [fetchData, fetchCategories, fetchValueCalculations]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, setItems, categories, categoriesWithBase, valueCalculations, loading, refresh };
}
