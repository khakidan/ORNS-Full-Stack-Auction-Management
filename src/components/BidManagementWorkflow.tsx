import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, CircleDot, CreditCard, ExternalLink, FileText, Handshake, LayoutDashboard, Loader2, RefreshCw, ShoppingBag, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfig } from "@/context/ConfigContext";
import { useAuth } from "@/context/AuthContext";
import { useAuction } from "@/context/AuctionContext";
import { postJsonOnce } from "@/services/apiClient";
import Dashboard from "./Dashboard";
import Bidders from "./Bidders";
import Items from "./Items";
import BidEntry from "./BidEntry";
import Checkout from "./Checkout";
import Receipts from "./Receipts";
import { AuctionStateBadge } from "./AuctionStateBadge";

interface BidManagementWorkflowProps {
  activeBidTab: string;
  onBidTabChange: (tab: string) => void;
  isVolunteer: boolean;
}

/**
 * The Bid Management page: the auction's stage buttons (Go Live, Close,
 * Set Up - for those allowed to change the stage) and its tabs. A
 * volunteer gets no stage buttons, no Open Spreadsheet and no Items tab.
 */
export default function BidManagementWorkflow({ activeBidTab, onBidTabChange, isVolunteer }: BidManagementWorkflowProps) {
  const { config } = useConfig();
  const { can } = useAuth();
  const { auctionState, isAuctionClosed, isBidManagementSetUp, closeAuction, goLive } = useAuction();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncBidders = async () => {
    setIsSyncing(true);
    const toastId = toast.loading("Checking credentials and backing up existing Bid-Management layers...");
    try {
      // Sent once: a resend would rebuild the bid sheet a second time (ROADMAP B3).
      await postJsonOnce("/api/bidders/sync", {
        spreadsheetId: config.bidManagementSpreadsheetId,
        auctionTicketSheetsID: config.auctionTicketsSpreadsheetId,
      }, "Failed to setup bid management app");

      toast.success("Successfully synchronized and re-sequenced all bidders, imported ticket sales, and generated full bid sheets!", { id: toastId });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e: any) {
      console.error("[Sync Error] Failed to setup bid management app:", e);
      toast.error(e.message || "Failed to setup bid management app", { id: toastId });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Bid Management</h2>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">
            Everything you need to run the auction!
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
          <AuctionStateBadge state={auctionState} className="order-first sm:order-none mb-2 sm:mb-0" />
          {!isAuctionClosed && can("auction.stage") && (
            <>
              {auctionState === "prep" && isBidManagementSetUp === true && (
                <Button
                  onClick={() => {
                    if (window.confirm("Take the auction LIVE? There's no way back to Prep from the app.")) {
                      goLive();
                    }
                  }}
                  size="sm"
                  className="gap-2 w-full sm:w-auto shrink-0 bg-emerald-600 text-white hover:bg-emerald-600/90"
                >
                  <CircleDot className="w-4 h-4" />
                  Go Live
                </Button>
              )}
              {auctionState === "live" && (
                <Button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to CLOSE the auction? This will disable further bid entries.")) {
                      closeAuction();
                    }
                  }}
                  size="sm"
                  variant="destructive"
                  className="gap-2 w-full sm:w-auto shrink-0"
                >
                  <AlertCircle className="w-4 h-4" />
                  Close Auction
                </Button>
              )}
              {isBidManagementSetUp === false && (
                <Button
                  onClick={handleSyncBidders}
                  disabled={isSyncing}
                  size="sm"
                  className="gap-2 w-full sm:w-auto shrink-0 bg-slate-900 text-slate-50 hover:bg-slate-900/90"
                >
                  {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {isSyncing ? "Setting up..." : "Set Up Bid Management App"}
                </Button>
              )}
            </>
          )}
          {config.bidManagementSpreadsheetId && !isVolunteer && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${config.bidManagementSpreadsheetId}`, "_blank", "noopener,noreferrer")}
              className="gap-2 w-full sm:w-auto"
            >
              <ExternalLink className="w-4 h-4" />
              Open Spreadsheet
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeBidTab} onValueChange={onBidTabChange} className="space-y-6">
        <div className="overflow-x-auto pb-2 -mx-6 px-6 md:mx-0 md:px-0">
          <TabsList className="bg-slate-200/50 p-1">
            <TabsTrigger value="dashboard" className="gap-2 px-4 py-2">
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="bidders" className="gap-2 px-4 py-2">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Bidders</span>
            </TabsTrigger>
            {!isVolunteer && (
              <TabsTrigger value="items" className="gap-2 px-4 py-2">
                <ShoppingBag className="w-4 h-4" />
                <span className="hidden sm:inline">Items</span>
              </TabsTrigger>
            )}
            {!isAuctionClosed && (
              <TabsTrigger value="bids" className="gap-2 px-4 py-2">
                <CreditCard className="w-4 h-4" />
                <span className="hidden sm:inline">Bid Entry</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="checkout" className="gap-2 px-4 py-2">
              <Handshake className="w-4 h-4" />
              <span className="hidden sm:inline">Checkout</span>
            </TabsTrigger>
            <TabsTrigger value="receipts" className="gap-2 px-4 py-2">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Receipts</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard" className="m-0 mt-2">
          {activeBidTab === "dashboard" && <Dashboard />}
        </TabsContent>
        <TabsContent value="bidders" className="m-0 mt-2">
          <Bidders />
        </TabsContent>
        {!isVolunteer && (
          <TabsContent value="items" className="m-0 mt-2">
            <Items />
          </TabsContent>
        )}
        <TabsContent value="bids" className="m-0 mt-2">
          <BidEntry />
        </TabsContent>
        <TabsContent value="checkout" className="m-0 mt-2">
          <Checkout />
        </TabsContent>
        <TabsContent value="receipts" className="m-0 mt-2">
          <Receipts />
        </TabsContent>
      </Tabs>
    </div>
  );
}
