import { useCallback, useState } from "react";
import { getSheetData } from "@/lib/google-api";
import { parseItemRows } from "@/lib/itemParsing";
import { AuctionItem } from "@/types";

export function useItemsData(spreadsheetId: string, auctionItemsSheet: string) {
  const [items, setItems] = useState<AuctionItem[]>([]);

  const fetchItems = useCallback(async () => {
    if (!spreadsheetId) return;
    try {
      const data = await getSheetData(spreadsheetId, `${auctionItemsSheet}!A:Z`);
      if (data && data.values?.length > 1) {
        setItems(parseItemRows(data.values));
      } else {
        setItems([]);
      }
    } catch (e) {
      console.error(e);
      setItems([]);
    }
  }, [spreadsheetId, auctionItemsSheet]);

  return { items, fetchItems };
}
