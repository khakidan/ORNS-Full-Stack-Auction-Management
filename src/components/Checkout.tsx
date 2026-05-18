import { useState, useEffect, useCallback } from "react";
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { fetchWithRetry, getSheetData, updateSheetData, getBaseUrl } from "@/lib/google-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Handshake, Receipt, Mail, CheckCircle2, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

import { Bidder, AuctionItem, Attendee } from "@/types";

interface WinnerRecord {
  bidderId: string;
  name: string;
  total: number;
  items: { id: string, name: string, price: number }[];
  paid: boolean;
  paymentMethod: string;
}

export default function Checkout() {
  const { bidders, items, loading, fetchAllData, attendees } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const ticketsSpreadsheetId = config.auctionTicketsSpreadsheetId;
  const scriptId = config.bidManagementScriptId;
  const bidManagementSheet = config.bidManagementSheet;
  const bidderNumbersSheet = config.bidderNumbersSheet;
  const folderId = config.receiptFolderId;
  const ornsLogoId = config.ornsLogoId;

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
  const [specialWinners, setSpecialWinners] = useState<{name: string, bidderId: string}[]>([]);

  const startBatchPrint = async () => {
    setShowPrintConfirm(false);
    try {
      setIsPrintingAll(true);
      if (!scriptId) {
        toast.error("Google Script ID not found. Please set it in the Config tab.");
        setIsPrintingAll(false);
        return;
      }

      console.log("[Checkout] Starting batch print...");
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/generate-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId, spreadsheetId }),
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
      if (!scriptId) {
        toast.error("Google Script ID not found. Please set it in the Config tab.");
        setIsEmailingAll(false);
        return;
      }

      console.log("[Checkout] Starting batch email...");
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/email-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId, spreadsheetId }),
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

        const wonItems: { id: string, name: string, price: number }[] = [];
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

  const pendingWinners = winners.filter(w => {
    const bidder = bidders.find(b => b.id === w.bidderId);
    return !bidder?.checkedOut;
  });

  const completedWinners = winners.filter(w => {
    const bidder = bidders.find(b => b.id === w.bidderId);
    return bidder?.checkedOut === true;
  });

  const displayedWinners = activeTab === "pending" ? pendingWinners : completedWinners;

  const filteredWinners = displayedWinners.filter(w => {
    const nameMatch = w.name.toLowerCase().includes(searchTerm.toLowerCase());
    const idMatch = w.bidderId.includes(searchTerm);
    return nameMatch || idMatch;
  });
  
  const handleEmailReceipt = async (winner: WinnerRecord) => {
    setProcessingId(`${winner.bidderId}-email`);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/email-only`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidderId: winner.bidderId,
          scriptId,
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
    const bidderInfo = bidders.find(b => b.id === winner.bidderId);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/receipts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidder: bidderInfo || { id: winner.bidderId, firstName: winner.name, lastName: "", email: "" },
          items: winner.items,
          total: winner.total,
          folderId,
          ornsLogoId,
          emailReceipt: false,
          createDoc: true,
          scriptId,
          spreadsheetId
        }),
        credentials: "include"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate Google Doc");
      }

      const data = await res.json();
      toast.success(`Receipt Doc created!`);
      if (data.documentId) {
        window.open(`https://docs.google.com/document/d/${data.documentId}/edit`, '_blank');
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
        duration: 10000,
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
    const method = paymentMethod;

    const previousWinners = [...winners];
    const bidderInfo = bidders.find(b => b.id === winner.bidderId);

    // Perform optimistic update locally immediately
    setWinners(prev => prev.map(w => {
      if (w.bidderId === winner.bidderId) {
        return { ...w, paid: true };
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
          paymentMethod: method,
          idempotencyKey
        }),
        credentials: "include"
      })
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to complete checkout transaction");
        }
        const bidderName = bidderInfo ? `${bidderInfo.firstName} ${bidderInfo.lastName}` : `Bidder ${winner.bidderId}`;
        toast.success(`${bidderName} marked as Paid (${method})`);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button
            onClick={() => setShowPrintConfirm(true)}
            disabled={isPrintingAll}
            className="bg-[#e31b23] text-white hover:bg-[#e31b23]/90 font-medium w-full sm:w-auto"
          >
            {isPrintingAll ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Receipt className="w-4 h-4 mr-2" />}
            {isPrintingAll ? "Printing Batch..." : "Print All Receipts"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowEmailConfirm(true)}
            disabled={isEmailingAll}
            className="w-full sm:w-auto"
          >
            {isEmailingAll ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Mail className="w-4 h-4 mr-2" />}
            {isEmailingAll ? "Sending Emails..." : "Email All Winners"}
          </Button>
        </div>
        <div className="text-sm font-medium text-muted-foreground bg-white px-3 py-1.5 rounded border border-slate-200 shadow-sm w-full sm:w-auto text-center">
          Total Winners: <span className="text-[#e31b23] font-bold">{winners.length}</span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-6">
        <div className="relative w-full md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search winners..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={fetchingWinners}>
          {fetchingWinners ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Handshake className="w-4 h-4 mr-2" />}
          Refresh Results
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="pending">
            Pending Checkout ({pendingWinners.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Already Checked Out ({completedWinners.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="m-0">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {fetchingWinners ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="animate-pulse bg-slate-100 h-[250px]" />
              ))
            ) : filteredWinners.length > 0 ? (
              filteredWinners.map((winner) => (
                <WinnerCard 
                  key={winner.bidderId} 
                  winner={winner} 
                  processingId={processingId}
                  handleEmailReceipt={handleEmailReceipt}
                  handlePrintReceipt={handlePrintReceipt}
                  handleMarkPaid={handleMarkPaid}
                />
              ))
            ) : (
              <EmptyWinnersState />
            )}
          </div>
        </TabsContent>

        <TabsContent value="completed" className="m-0">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {fetchingWinners ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="animate-pulse bg-slate-100 h-[250px]" />
              ))
            ) : filteredWinners.length > 0 ? (
              filteredWinners.map((winner) => (
                <WinnerCard 
                  key={winner.bidderId} 
                  winner={winner} 
                  processingId={processingId}
                  handleEmailReceipt={handleEmailReceipt}
                  handlePrintReceipt={handlePrintReceipt}
                  handleMarkPaid={handleMarkPaid}
                />
              ))
            ) : (
              <EmptyWinnersState />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={showPrintConfirm} onOpenChange={setShowPrintConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Print All Receipts</DialogTitle>
            <DialogDescription>
              This will generate Google Doc receipts for ALL winning bidders. These will be created in two batch documents to avoid timing out. Proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPrintConfirm(false)}>Cancel</Button>
            <Button onClick={startBatchPrint} className="bg-[#e31b23] text-white hover:bg-[#e31b23]/90">Yes, Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEmailConfirm} onOpenChange={setShowEmailConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email All Winners</DialogTitle>
            <DialogDescription>
              This will email receipts to ALL winning bidders who have an email on file. Proceed?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmailConfirm(false)}>Cancel</Button>
            <Button onClick={startBatchEmail}>Yes, Email</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Payment Method</DialogTitle>
            <DialogDescription>
              How is {winnerToPay?.name} paying for their items today?
              Total: <span className="font-bold text-[#e31b23]">${winnerToPay?.total.toFixed(2)}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-4">
            <Button 
              variant={paymentMethod === "Cash" ? "default" : "outline"} 
              className={paymentMethod === "Cash" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
              onClick={() => setPaymentMethod("Cash")}
            >
              Cash
            </Button>
            <Button 
              variant={paymentMethod === "Check" ? "default" : "outline"} 
              className={paymentMethod === "Check" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
              onClick={() => setPaymentMethod("Check")}
            >
              Check
            </Button>
            <Button 
              variant={paymentMethod === "Credit Card/PayPal" ? "default" : "outline"} 
              className={paymentMethod === "Credit Card/PayPal" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
              onClick={() => setPaymentMethod("Credit Card/PayPal")}
            >
              Credit Card / PayPal
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancel</Button>
            <Button 
              onClick={confirmMarkPaid} 
              disabled={!paymentMethod || isSubmittingPayment}
              className="bg-[#e31b23] text-white hover:bg-[#e31b23]/90"
            >
              {isSubmittingPayment && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WinnerCard({ winner, processingId, handleEmailReceipt, handlePrintReceipt, handleMarkPaid }: { 
  winner: WinnerRecord, 
  processingId: string | null,
  handleEmailReceipt: (w: WinnerRecord) => void,
  handlePrintReceipt: (w: WinnerRecord) => void,
  handleMarkPaid: (w: WinnerRecord) => void
}) {
  return (
    <Card className="flex flex-col h-full shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-2 border-b">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-xl">{winner.name}</CardTitle>
            <CardDescription>Bidder #{winner.bidderId}</CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">${winner.total.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{winner.items.length} items won</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 py-4">
        <ul className="space-y-2">
          {winner.items.map((item, i: number) => (
            <li key={i} className="flex justify-between text-sm">
              <span className="text-muted-foreground max-w-[70%] truncate">{item.name}</span>
              <span className="font-medium">${item.price.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="pt-4 border-t flex-wrap gap-2 bg-slate-50/50">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 min-w-[100px] gap-2"
          onClick={() => handleEmailReceipt(winner)}
          disabled={!!processingId && processingId.startsWith(`${winner.bidderId}-`)}
        >
          {processingId === `${winner.bidderId}-email` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {processingId === `${winner.bidderId}-email` ? "Sending..." : "Email Receipt"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 min-w-[100px] gap-2"
          onClick={() => handlePrintReceipt(winner)}
          disabled={!!processingId && processingId.startsWith(`${winner.bidderId}-`)}
        >
          {processingId === `${winner.bidderId}-print` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
          {processingId === `${winner.bidderId}-print` ? "Printing..." : "Print Receipt"}
        </Button>
        {winner.paid ? (
          <div className="w-full py-2 text-center text-emerald-600 font-medium flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Paid
          </div>
        ) : (
          <Button
            size="sm"
            className="w-full gap-2"
            onClick={() => handleMarkPaid(winner)}
            disabled={!!processingId && processingId.startsWith(`${winner.bidderId}-`)}
          >
            {processingId === `${winner.bidderId}-pay` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Mark Paid
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function EmptyWinnersState() {
  return (
    <div className="col-span-full py-20 text-center space-y-4">
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
        <Receipt className="w-8 h-8 text-slate-300" />
      </div>
      <div className="text-muted-foreground">No winners found in this category.</div>
    </div>
  );
}
