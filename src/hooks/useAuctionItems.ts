import { useState, useEffect, useCallback } from "react";
import { getSheetData } from "@/services/google-api";
import { AuctionItem } from "@/types";
import { getCategoryBase } from "@/lib/categoryHelpers";
import { parseItemRows } from "@/lib/itemParsing";
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
        const tiers = data.values.slice(1).map((row: string[]) => ({
          minRange: parseFloat(row[0]?.toString().replace(/[^0-9.-]+/g, "") || "0"),
          minRaise: parseFloat(row[1]?.toString().replace(/[^0-9.-]+/g, "") || "0")
        })).filter((t) => !isNaN(t.minRange) && !isNaN(t.minRaise) && t.minRaise > 0);
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
        const catsWithBase = data.values.slice(1).map((row: string[]) => {
          const catName = row[0]?.toString() || "";
          const parsedBase = parseInt(row[1]?.toString() || "0", 10) || 0;
          return {
            name: catName,
            base: parsedBase || getCategoryBase(catName)
          };
        }).filter((c) => c.name);
        setCategoriesWithBase(catsWithBase);
        setCategories(catsWithBase.map((c) => c.name));
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
        setItems(parseItemRows(data.values));
      }
    } catch (error) {
      console.error("Failed to fetch auction items:", error);
      toast.error("Failed to load auction items");
    } finally {
      setLoading(false);
    }
  }, [spreadsheetId]);

  /** `silent`: a live refresh (someone else changed something) - no loading spinner. */
  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    await Promise.all([fetchData(), fetchCategories(), fetchValueCalculations()]);
    setLoading(false);
  }, [fetchData, fetchCategories, fetchValueCalculations]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, setItems, categories, categoriesWithBase, valueCalculations, loading, refresh };
}
