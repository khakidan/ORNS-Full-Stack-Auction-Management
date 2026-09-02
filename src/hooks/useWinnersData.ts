import { useCallback, useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl, getSheetData } from "@/lib/google-api";
import { Bidder } from "@/types";

export function useWinnersData(spreadsheetId: string, bidders: Bidder[], bidManagementSheet: string, bidderNumbersSheet: string) {
  const [winners, setWinners] = useState<Record<string, string>>({});
  const [totalRaised, setTotalRaised] = useState(0);

  const fetchWinners = useCallback(async () => {
    if (!spreadsheetId || bidders.length === 0) return;
    try {
      const data = await getSheetData(spreadsheetId, `${bidManagementSheet}!A:ZZ`);

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
  }, [spreadsheetId, bidders, bidManagementSheet]);

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
        bidManagementSheet,
        bidderNumbersSheet,
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

  return { winners, totalRaised, fetchWinners, recordWinningBid };
}
