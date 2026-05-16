import { useState, useEffect } from "react";
import { useAuction, Bidder } from "@/hooks/useAuction";
import { useAttendees } from "@/hooks/useAttendees";
import { getSheetData, updateSheetData, getBaseUrl } from "@/lib/google-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Handshake, Receipt, Mail, CheckCircle2, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function Checkout() {
  const { bidders, items, loading, fetchBidders, fetchItems } = useAuction();
  const { attendees, fetchAttendees } = useAttendees();
  const [winners, setWinners] = useState<any[]>([]);
  const [fetchingWinners, setFetchingWinners] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const [isEmailingAll, setIsEmailingAll] = useState(false);
  const [showPrintConfirm, setShowPrintConfirm] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<"pending" | "completed">("pending");

  useEffect(() => {
    const ticketsSpreadsheetId = localStorage.getItem("auctionTicketsSpreadsheetId");
    fetchAttendees(ticketsSpreadsheetId);
  }, [fetchAttendees]);

  const startBatchPrint = async () => {
    setShowPrintConfirm(false);
    try {
      setIsPrintingAll(true);
      const scriptId = localStorage.getItem("bidManagementScriptId");
      if (!scriptId) {
        toast.error("Google Script ID not found. Please set it in the Config tab.");
        setIsPrintingAll(false);
        return;
      }

      console.log("[Checkout] Starting batch print...");
      const spreadsheetId = localStorage.getItem("spreadsheetId");
      const res = await fetch(`${getBaseUrl()}/api/receipts/generate-all`, {
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
      const scriptId = localStorage.getItem("bidManagementScriptId");
      if (!scriptId) {
        toast.error("Google Script ID not found. Please set it in the Config tab.");
        setIsEmailingAll(false);
        return;
      }

      console.log("[Checkout] Starting batch email...");
      const spreadsheetId = localStorage.getItem("spreadsheetId");
      const res = await fetch(`${getBaseUrl()}/api/receipts/email-all`, {
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

  const loadWinners = async () => {
    const spreadsheetId = localStorage.getItem("spreadsheetId");
    if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) return;

    setFetchingWinners(true);
    try {
      const sheetName = localStorage.getItem("bidManagementSheet") || "Bid-Management";
      const data = await getSheetData(spreadsheetId, `${sheetName}!1:100`);

      if (!data.values || data.values.length < 4) {
        setWinners([]);
        return;
      }

      const header = data.values[0];
      const itemsList: any[] = [];

      for (let j = 0; j < header.length; j += 2) {
        const bidderId = header[j]?.toString();
        if (!bidderId) continue;

        const wonItems = [];
        let total = 0;

        for (let i = 3; i < data.values.length; i++) {
          const row = data.values[i];
          if (row && row[j] && row[j + 1]) {
            const itemId = row[j].toString();
            const price = parseFloat(row[j + 1]) || 0;
            const itemInfo = items.find(it => it.id === itemId);
            wonItems.push({ id: itemId, name: itemInfo?.name || "Unknown Item", price });
            total += price;
          }
        }

        if (wonItems.length > 0) {
          const bidderInfo = bidders.find(b => b.id === bidderId);
          itemsList.push({
            bidder: bidderInfo || { id: bidderId, firstName: "Unknown", lastName: "Bidder", email: "" },
            wonItems,
            total
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
  };

  const handleRefresh = async () => {
    setFetchingWinners(true);
    await fetchBidders();
    await fetchItems();
    await loadWinners();
  };

  useEffect(() => {
    if (bidders.length && items.length) {
      loadWinners();
    }
  }, [bidders, items]);

  const pendingWinners = winners.filter(w => {
    const bidder = bidders.find(b => b.id === w.bidder.id);
    return !bidder?.checkedOut;
  });

  const completedWinners = winners.filter(w => {
    const bidder = bidders.find(b => b.id === w.bidder.id);
    return bidder?.checkedOut === true;
  });

  const displayedWinners = activeTab === "pending" ? pendingWinners : completedWinners;

  const filteredWinners = displayedWinners.filter(w => {
    const nameMatch = `${w.bidder.firstName} ${w.bidder.lastName}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const idMatch = w.bidder.id.includes(searchTerm);
    return nameMatch || idMatch;
  });
  
  const handleEmailReceipt = async (winner: any) => {
    setProcessingId(`${winner.bidder.id}-email`);
    const scriptId = localStorage.getItem("bidManagementScriptId");
    const spreadsheetId = localStorage.getItem("spreadsheetId");
    try {
      const res = await fetch(`${getBaseUrl()}/api/receipts/email-only`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidderId: winner.bidder.id,
          scriptId,
          spreadsheetId
        }),
        credentials: "include"
      });

      if (!res.ok) throw new Error("Failed to send email");
      toast.success(`Receipt emailed to ${winner.bidder.firstName}`);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handlePrintReceipt = async (winner: any) => {
    const folderId = localStorage.getItem("receiptFolderId");
    const ornsLogoId = localStorage.getItem("ornsLogoId");
    const scriptId = localStorage.getItem("bidManagementScriptId");
    const spreadsheetId = localStorage.getItem("spreadsheetId");
    setProcessingId(`${winner.bidder.id}-print`);
    try {
      const res = await fetch(`${getBaseUrl()}/api/receipts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidder: winner.bidder,
          items: winner.wonItems,
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

  const handleMarkPaid = async (winner: any) => {
    const spreadsheetId = localStorage.getItem("spreadsheetId");
    if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) {
      toast.error("Bid Management Spreadsheet ID not configured correctly.");
      return;
    }
    setProcessingId(`${winner.bidder.id}-pay`);
    try {
      const sheetName = localStorage.getItem("bidderNumbersSheet") || "Bidder-Numbers";
      
      // Dynamically find the row to prevent sorting bugs
      const data = await getSheetData(spreadsheetId!, `${sheetName}!A:A`);
      const rowIndex = data.values.findIndex((row: any) => row[0]?.toString() === winner.bidder.id) + 1;
      
      if (rowIndex > 1) {
        await updateSheetData(spreadsheetId!, `${sheetName}!G${rowIndex}:H${rowIndex}`, [[true, true]]);
        
        // Also mark as paid in Auction Tickets if they're a walk-in or pending ticket buyer
        const ticketsSpreadsheetId = localStorage.getItem("auctionTicketsSpreadsheetId");
        if (ticketsSpreadsheetId && attendees.length > 0) {
          const attendee = attendees.find(a => 
            a.firstName.trim().toLowerCase() === winner.bidder.firstName.trim().toLowerCase() &&
            a.lastName.trim().toLowerCase() === winner.bidder.lastName.trim().toLowerCase()
          );
          if (attendee && attendee.sheet === 'tickets') {
            await updateSheetData(ticketsSpreadsheetId, `${attendee.sheet}!U${attendee.rowIndex}`, [["Paid"]]);
          }
        }
        
        toast.success(`${winner.bidder.firstName} marked as Paid & Checked Out`);
        loadWinners();
      } else {
        throw new Error("Bidder not found in spreadsheet");
      }
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setProcessingId(null);
    }
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
                  key={winner.bidder.id} 
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
                  key={winner.bidder.id} 
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
    </div>
  );
}

function WinnerCard({ winner, processingId, handleEmailReceipt, handlePrintReceipt, handleMarkPaid }: any) {
  return (
    <Card className="flex flex-col h-full shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-2 border-b">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-xl">{winner.bidder.firstName} {winner.bidder.lastName}</CardTitle>
            <CardDescription>Bidder #{winner.bidder.id}</CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">${winner.total.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{winner.wonItems.length} items won</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 py-4">
        <ul className="space-y-2">
          {winner.wonItems.map((item: any, i: number) => (
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
          disabled={!!processingId && processingId.startsWith(`${winner.bidder.id}-`)}
        >
          {processingId === `${winner.bidder.id}-email` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {processingId === `${winner.bidder.id}-email` ? "Sending..." : "Email Receipt"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 min-w-[100px] gap-2"
          onClick={() => handlePrintReceipt(winner)}
          disabled={!!processingId && processingId.startsWith(`${winner.bidder.id}-`)}
        >
          {processingId === `${winner.bidder.id}-print` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
          {processingId === `${winner.bidder.id}-print` ? "Printing..." : "Print Receipt"}
        </Button>
        {winner.bidder.checkedOut ? (
          <div className="w-full py-2 text-center text-emerald-600 font-medium flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Checked Out
          </div>
        ) : (
          <Button
            size="sm"
            className="w-full gap-2"
            onClick={() => handleMarkPaid(winner)}
            disabled={!!processingId && processingId.startsWith(`${winner.bidder.id}-`)}
          >
            {processingId === `${winner.bidder.id}-pay` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
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
