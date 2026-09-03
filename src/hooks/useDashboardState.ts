import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getSheetData, updateSheetData, appendSheetData } from "@/services/google-api";
import { Bidder } from "@/types";

interface UseDashboardStateArgs {
  bidders: Bidder[];
  items: unknown[];
  winners: Record<string, string>;
  spreadsheetId: string;
  isAuctionClosed: boolean;
}

/**
 * Owns all Dashboard state, data loading, and derived stats: the
 * post-auction follow-up lists, the special-winner (gift card / raffle)
 * form, and the attendance/checkout/item stat calculations. Kept
 * separate from Dashboard.tsx so that component stays focused on
 * composing/rendering the split-out widget pieces.
 */
export function useDashboardState({ bidders, items, winners, spreadsheetId, isAuctionClosed }: UseDashboardStateArgs) {
  const [followUpRecords, setFollowUpRecords] = useState<string[][]>([]);
  const [loadingFollowUp, setLoadingFollowUp] = useState(false);

  const [giftCardWinnerId, setGiftCardWinnerId] = useState("");
  const [raffleWinnerId, setRaffleWinnerId] = useState("");
  const [savingGiftCard, setSavingGiftCard] = useState(false);
  const [savingRaffle, setSavingRaffle] = useState(false);

  const fetchFollowUpRecords = async () => {
    setLoadingFollowUp(true);
    try {
      const data = await getSheetData(spreadsheetId, "Follow-Up!A:C");
      if (data.values && data.values.length > 1) {
        setFollowUpRecords(data.values.slice(1));
      }
    } catch (err) {
      console.error("Failed to fetch follow-up records", err);
    } finally {
      setLoadingFollowUp(false);
    }
  };

  useEffect(() => {
    const fetchSpecialWinners = async () => {
      if (!spreadsheetId) return;
      try {
        const data = await getSheetData(spreadsheetId, "Special-Winners!A2:B3");
        if (data.values) {
          const rows = data.values;
          if (rows[0] && rows[0][1]) setGiftCardWinnerId(rows[0][1].toString());
          if (rows[1] && rows[1][1]) setRaffleWinnerId(rows[1][1].toString());
        }
      } catch (err) {
        console.error("Failed to fetch special winners", err);
      }
    };
    fetchSpecialWinners();

    if (isAuctionClosed && spreadsheetId) {
      fetchFollowUpRecords();
    }
  }, [spreadsheetId, isAuctionClosed]);

  const saveGiftCardWinner = async () => {
    if (!spreadsheetId) {
      toast.error("Spreadsheet ID not configured.");
      return;
    }

    const bidder = bidders.find(b => b.id === giftCardWinnerId);
    if (!bidder && giftCardWinnerId) {
      toast.error("Bidder ID not found");
      return;
    }

    if (bidder?.checkedOut) {
      toast.warning("Checked Out Warning", {
        description: `Warning: ${bidder.firstName} ${bidder.lastName} won "$500 Amazon Gift Card" but has already checked out.`,
        duration: Infinity,
        action: {
          label: "I have confirmed",
          onClick: () => console.log("Confirmed checkout warning for gift card"),
        },
      });
    }

    setSavingGiftCard(true);
    try {
      await updateSheetData(spreadsheetId, "Special-Winners!B2", [[giftCardWinnerId]]);
      if (bidder?.checkedOut) {
        await appendSheetData(spreadsheetId, "Follow-Up!A:C", [[giftCardWinnerId, "$500 Amazon Gift Card", ""]]);
        fetchFollowUpRecords();
      }
      toast.success("Updated $500 Amazon Gift Card winner");
    } catch (err: any) {
      toast.error("Failed to save winner: " + (err.message || "Unknown error"));
    } finally {
      setSavingGiftCard(false);
    }
  };

  const saveRaffleWinner = async () => {
    if (!spreadsheetId) {
      toast.error("Spreadsheet ID not configured.");
      return;
    }

    const bidder = bidders.find(b => b.id === raffleWinnerId);
    if (!bidder && raffleWinnerId) {
      toast.error("Bidder ID not found");
      return;
    }

    if (bidder?.checkedOut) {
      toast.warning("Checked Out Warning", {
        description: `Warning: ${bidder.firstName} ${bidder.lastName} won "50/50 Raffle" but has already checked out.`,
        duration: Infinity,
        action: {
          label: "I have confirmed",
          onClick: () => console.log("Confirmed checkout warning for raffle"),
        },
      });
    }

    setSavingRaffle(true);
    try {
      await updateSheetData(spreadsheetId, "Special-Winners!B3", [[raffleWinnerId]]);
      if (bidder?.checkedOut) {
        await appendSheetData(spreadsheetId, "Follow-Up!A:C", [[raffleWinnerId, "50/50 Raffle", ""]]);
        fetchFollowUpRecords();
      }
      toast.success("Updated 50/50 Raffle winner");
    } catch (err: any) {
      toast.error("Failed to save winner: " + (err.message || "Unknown error"));
    } finally {
      setSavingRaffle(false);
    }
  };

  const getBidderName = (id: string) => {
    if (!id) return "";
    const b = bidders.find(b => b.id === id);
    return b ? `${b.firstName} ${b.lastName}` : "Bidder not found";
  };

  const winningNames = useMemo(() => new Set(Object.values(winners)), [winners]);

  const checkedInCount = bidders.filter(b => b.checkedIn).length;
  const checkedOutCount = bidders.filter(b => b.checkedOut).length;
  const pendingCheckoutBidders = bidders.filter(b => {
    if (b.checkedOut) return false;
    if (b.checkedIn) return true;
    const fullName = `${b.firstName} ${b.lastName}`;
    if (b.isProxy && winningNames.has(fullName)) return true;
    return false;
  });
  const pendingCheckoutCount = pendingCheckoutBidders.length;
  const totalBidders = bidders.length;
  const itemsCount = items.length;

  const unattendedBidders = useMemo(() => {
    return bidders
      .filter(b => !b.checkedIn && !b.isProxy)
      .sort((a, b) => {
        const idA = parseInt(a.id, 10) || 0;
        const idB = parseInt(b.id, 10) || 0;
        return idA - idB;
      });
  }, [bidders]);

  const proxyBidders = useMemo(() => {
    return bidders
      .filter(b => b.isProxy)
      .sort((a, b) => parseInt(a.id) - parseInt(b.id));
  }, [bidders]);

  const bidderStats = [
    { name: "Checked In", value: checkedInCount, fill: "#10b981" },
    { name: "Checked Out", value: checkedOutCount, fill: "#0c63d5" },
    // Proxy bidders are neither checked in nor "absent" in the ordinary
    // sense (they never attend), so they're excluded here the same way
    // unattendedBidders already excludes them - otherwise this slice
    // double-counts proxies as missing attendees.
    { name: "Not Present", value: totalBidders - checkedInCount - proxyBidders.length, fill: "#ef4444" },
  ];

  return {
    // Post-auction follow-up
    followUpRecords,
    loadingFollowUp,
    fetchFollowUpRecords,
    pendingCheckoutBidders,
    pendingCheckoutCount,
    unattendedBidders,
    getBidderName,

    // Special winners form
    giftCardWinnerId,
    setGiftCardWinnerId,
    raffleWinnerId,
    setRaffleWinnerId,
    savingGiftCard,
    savingRaffle,
    saveGiftCardWinner,
    saveRaffleWinner,

    // Stats
    checkedInCount,
    checkedOutCount,
    totalBidders,
    itemsCount,
    proxyBidders,
    bidderStats,
  };
}
