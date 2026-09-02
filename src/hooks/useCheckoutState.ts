import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getSheetData, getBaseUrl } from "@/services/google-api";
import { Bidder, AuctionItem, Attendee } from "@/types";

export interface WinnerRecord {
  bidderId: string;
  name: string;
  total: number;
  items: { id: string; name: string; price: number }[];
  paid: boolean;
  paymentPending?: boolean;
  paymentMethod: string;
}

interface UseCheckoutStateArgs {
  bidders: Bidder[];
  items: AuctionItem[];
  attendees: Attendee[];
  fetchAllData: () => Promise<void>;
  spreadsheetId: string;
  ticketsSpreadsheetId: string;
  bidManagementSheet: string;
  bidderNumbersSheet: string;
  folderId: string;
}

/**
 * Owns all winners-list state and mutation handlers for the checkout
 * screen: loading/parsing the winners sheet, search/tab filtering,
 * per-winner receipt actions, mark-paid flow, and the batch print/email
 * actions. Kept separate from Checkout.tsx so that component stays
 * focused on composing/rendering the split-out pieces.
 */
export function useCheckoutState({
  bidders,
  items,
  attendees,
  fetchAllData,
  spreadsheetId,
  ticketsSpreadsheetId,
  bidManagementSheet,
  bidderNumbersSheet,
  folderId,
}: UseCheckoutStateArgs) {
  const [winners, setWinners] = useState<WinnerRecord[]>([]);
  const [fetchingWinners, setFetchingWinners] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [isEmailingAll, setIsEmailingAll] = useState(false);
  const [showPrintConfirm, setShowPrintConfirm] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [winnerToPay, setWinnerToPay] = useState<WinnerRecord | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [specialWinners, setSpecialWinners] = useState<{ name: string; bidderId: string }[]>([]);

  const startBatchPrint = async () => {
    setShowPrintConfirm(false);
    try {
      setIsPrintingAll(true);

      console.log("[Checkout] Starting batch print...");
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/generate-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, receiptFolderId: folderId }),
        credentials: "include"
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Batch generation failed");
      toast.success("Batch receipt generation started! Check your Receipts folder in a few minutes.");
    } catch (error: any) {
      console.error("[Checkout] Batch print error:", error);
      toast.error(error.message || "An unexpected error occurred during batch printing");
    } finally {
      setIsPrintingAll(false);
    }
  };

  const startBatchEmail = async () => {
    setShowEmailConfirm(false);
    try {
      setIsEmailingAll(true);

      console.log("[Checkout] Starting batch email...");
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/email-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId }),
        credentials: "include"
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Batch email failed");
      toast.success("Batch emails are being sent! Check your Sent folder in a few minutes.");
    } catch (error: any) {
      console.error("[Checkout] Batch email error:", error);
      toast.error(error.message || "An unexpected error occurred during batch emailing");
    } finally {
      setIsEmailingAll(false);
    }
  };

  const loadWinners = useCallback(async () => {
    if (!spreadsheetId) return;

    setFetchingWinners(true);
    try {
      // Fetch special winners for alerts
      const specialData = await getSheetData(spreadsheetId, "Special-Winners!A2:B3");
      if (specialData.values) {
        setSpecialWinners(specialData.values.map((row: any) => ({
          name: row[0],
          bidderId: row[1]?.toString() || ""
        })));
      }

      const sheetName = bidManagementSheet;
      const data = await getSheetData(spreadsheetId, `${sheetName}!1:100`);

      if (!data.values || data.values.length < 4) {
        setWinners([]);
        return;
      }

      const header = data.values[0] as string[];
      const itemsList: WinnerRecord[] = [];

      for (let j = 0; j < header.length; j += 2) {
        const bidderId = header[j]?.toString();
        if (!bidderId) continue;

        const wonItems: { id: string; name: string; price: number }[] = [];
        let total = 0;

        for (let i = 3; i < data.values.length; i++) {
          const row = data.values[i];
          if (row && row[j] && row[j + 1]) {
            const itemId = row[j].toString();
            const priceVal = row[j + 1]?.toString().replace(/[^0-9.]/g, "") || "0";
            const price = parseFloat(priceVal) || 0;
            const itemInfo = items.find(it => it.id === itemId);
            wonItems.push({ id: itemId, name: itemInfo?.name || "Unknown Item", price });
            total += price;
          }
        }

        if (wonItems.length > 0) {
          const bidderInfo = bidders.find(b => b.id === bidderId);
          itemsList.push({
            bidderId,
            name: bidderInfo ? `${bidderInfo.firstName} ${bidderInfo.lastName}` : `Bidder ${bidderId}`,
            total,
            items: wonItems,
            paid: bidderInfo?.paid || false,
            paymentPending: !!bidderInfo?.checkoutTimestamp && !bidderInfo?.paid,
            paymentMethod: "" // Will be determined from bidders/attendees if needed
          });
        }
      }
      setWinners(itemsList);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load winners");
    } finally {
      setFetchingWinners(false);
    }
  }, [spreadsheetId, bidManagementSheet, items, bidders]);

  const handleRefresh = async () => {
    setFetchingWinners(true);
    await fetchAllData();
    await loadWinners();
  };

  useEffect(() => {
    if (bidders.length && items.length) {
      loadWinners();
    }
  }, [bidders, items, loadWinners]);

  const filteredWinners = useMemo(() => {
    const pendingWinners = winners.filter(w => {
      const bidder = bidders.find(b => b.id === w.bidderId);
      return !bidder?.checkedOut;
    });

    const completedWinners = winners.filter(w => {
      const bidder = bidders.find(b => b.id === w.bidderId);
      return bidder?.checkedOut === true;
    });

    const displayedWinners = activeTab === "pending" ? pendingWinners : completedWinners;

    const filtered = displayedWinners.filter(w => {
      const nameMatch = w.name.toLowerCase().includes(searchTerm.toLowerCase());
      const idMatch = w.bidderId.includes(searchTerm);
      return nameMatch || idMatch;
    });

    return { pendingWinners, completedWinners, filtered };
  }, [winners, bidders, activeTab, searchTerm]);

  const handleEmailReceipt = async (winner: WinnerRecord) => {
    setProcessingId(`${winner.bidderId}-email`);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/email-only`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidderId: winner.bidderId,
          spreadsheetId
        }),
        credentials: "include"
      });

      if (!res.ok) throw new Error("Failed to send email");
      toast.success(`Receipt emailed to ${winner.name}`);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handlePrintReceipt = async (winner: WinnerRecord) => {
    setProcessingId(`${winner.bidderId}-print`);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidderId: winner.bidderId,
          emailReceipt: false,
          spreadsheetId,
          receiptFolderId: folderId
        }),
        credentials: "include"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate Google Doc");
      }

      const data = await res.json();
      toast.success(`Receipt Doc created! Subtotal: $${data.subtotal}`);
      if (data.paymentUrl) {
        console.log(`Payment URL: ${data.paymentUrl}`);
      }
      if (data.docId) {
        window.open(`https://docs.google.com/document/d/${data.docId}/edit`, '_blank');
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleMarkPaid = (winner: WinnerRecord) => {
    // Check for high-value items in Special-Winners sheet
    const alertItems = specialWinners.filter(sw => sw.bidderId === winner.bidderId);

    if (alertItems.length > 0) {
      const itemNames = alertItems.map(i => i.name).join(" and ");
      toast.warning(`High-Value Alert: ${itemNames}`, {
        description: `Ensure this bidder has received their ${itemNames} prize before completing checkout.`,
        duration: Infinity,
        action: {
          label: "I have confirmed",
          onClick: () => {
            setWinnerToPay(winner);
            setPaymentMethod("");
            setShowPaymentDialog(true);
          }
        }
      });
      return;
    }

    setWinnerToPay(winner);
    setPaymentMethod("");
    setShowPaymentDialog(true);
  };

  const confirmMarkPaid = async () => {
    if (!winnerToPay || !paymentMethod) {
      toast.error("Please select a payment method");
      return;
    }

    if (!spreadsheetId) {
      toast.error("Bid Management Spreadsheet ID not configured correctly.");
      return;
    }

    setIsSubmittingPayment(true);
    const winner = winnerToPay;

    let mappedMethod = "UNKNOWN";
    if (paymentMethod === "Cash") mappedMethod = "CASH";
    else if (paymentMethod === "Check") mappedMethod = "CHECK";
    else if (paymentMethod === "Credit Card/PayPal") mappedMethod = "PAYPAL";

    const method = paymentMethod;

    const previousWinners = [...winners];
    const bidderInfo = bidders.find(b => b.id === winner.bidderId);

    // Perform optimistic update locally immediately
    setWinners(prev => prev.map(w => {
      if (w.bidderId === winner.bidderId) {
        return { ...w, paid: mappedMethod !== "PAYPAL", paymentPending: mappedMethod === "PAYPAL" };
      }
      return w;
    }));

    const attendee = ticketsSpreadsheetId && attendees.find(a =>
      bidderInfo &&
      a.firstName.trim().toLowerCase() === bidderInfo.firstName.trim().toLowerCase() &&
      a.lastName.trim().toLowerCase() === bidderInfo.lastName.trim().toLowerCase()
    );

    const idempotencyKey = crypto.randomUUID();

    // Close dialog immediately
    setShowPaymentDialog(false);

    // Fire background sync
    fetchWithRetry(`${getBaseUrl()}/api/auction/checkout-mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bidderId: winner.bidderId,
        spreadsheetId,
        ticketsSpreadsheetId,
        bidderNumbersSheet,
        attendeeInfo: attendee && attendee.sheet === 'tickets' ? { sheet: attendee.sheet, rowIndex: attendee.rowIndex } : null,
        paymentMethod: mappedMethod,
        amount: winner.total,
        idempotencyKey
      }),
      credentials: "include"
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to complete checkout transaction");
        }

        const data = await res.json();
        const bidderName = bidderInfo ? `${bidderInfo.firstName} ${bidderInfo.lastName}` : `Bidder ${winner.bidderId}`;

        if (res.status === 202 || data.deferred) {
          toast.info(`${bidderName} checkout sent. Pending PayPal background verification.`);
          setWinners(prev => prev.map(w => w.bidderId === winner.bidderId ? { ...w, paymentPending: true, paid: false } : w));
        } else {
          toast.success(`${bidderName} marked as Paid (${method})`);
          setWinners(prev => prev.map(w => w.bidderId === winner.bidderId ? { ...w, paymentPending: false, paid: true } : w));
        }

        fetchAllData(); // Refresh all data to ensure sync
      })
      .catch((error: any) => {
        console.error("[Checkout] Sync error:", error);
        setWinners(previousWinners);
        toast.error(`Failed to sync updates—retrying... local state reverted.`);
      })
      .finally(() => {
        setIsSubmittingPayment(false);
        setWinnerToPay(null);
      });
  };

  return {
    winners,
    fetchingWinners,
    processingId,
    searchTerm,
    setSearchTerm,
    activeTab,
    setActiveTab,
    pendingWinners: filteredWinners.pendingWinners,
    completedWinners: filteredWinners.completedWinners,
    filteredWinners: filteredWinners.filtered,

    handleRefresh,
    handleEmailReceipt,
    handlePrintReceipt,
    handleMarkPaid,

    isPrintingAll,
    showPrintConfirm,
    setShowPrintConfirm,
    startBatchPrint,

    isEmailingAll,
    showEmailConfirm,
    setShowEmailConfirm,
    startBatchEmail,

    showPaymentDialog,
    setShowPaymentDialog,
    winnerToPay,
    paymentMethod,
    setPaymentMethod,
    isSubmittingPayment,
    confirmMarkPaid,
  };
}
