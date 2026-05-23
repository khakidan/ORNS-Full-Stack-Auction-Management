/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { fetchWithRetry } from "@/lib/google-api";
import { useConfig } from "@/context/ConfigContext";
import { useGoogleAuth } from "@/hooks/useGoogleAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Loader2, LayoutDashboard, RefreshCw, Users, ShoppingBag, CreditCard, Handshake, WalletCards, Settings, LogOut, FileText, Ticket, Package, ClipboardList, PanelLeftClose, Menu, ArrowUp, AlertCircle, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Dashboard from "./components/Dashboard";
import Bidders from "./components/Bidders";
import Items from "./components/Items";
import BidEntry from "./components/BidEntry";
import Checkout from "./components/Checkout";
import ConfigSettings from "./components/ConfigSettings";
import Receipts from "./components/Receipts";
import AuctionTicketsWorkflow from "./components/AuctionTicketsWorkflow";
import AuctionItemsWorkflow from "./components/AuctionItemsWorkflow";
import { useAuction } from "./context/AuctionContext";

type WorkflowType = 'tickets' | 'items' | 'bids' | 'settings';

const WORKFLOW_PATHS: Record<WorkflowType, string> = {
  items: "/AuctionItemsWorkflow",
  tickets: "/AuctionTicketsWorkflow",
  bids: "/BidManagement",
  settings: "/Configuration"
};

const getWorkflowFromPath = (path: string): WorkflowType | null => {
  const cleanPath = path.toLowerCase();
  if (cleanPath.includes("items")) return "items";
  if (cleanPath.includes("tickets")) return "tickets";
  if (cleanPath.includes("bid")) return "bids";
  if (cleanPath.includes("config") || cleanPath.includes("settings") || cleanPath.includes("configuration")) return "settings";
  return null;
};

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 300);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 p-3 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:bg-primary/90 transition-all z-50 flex items-center justify-center"
          title="Back to Top"
        >
          <ArrowUp className="w-5 h-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const { config } = useConfig();
  const { isAuctionClosed, closeAuction } = useAuction();
  const { authenticated, handleLogin, checkAuth, handleLogout } = useGoogleAuth();
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowType>(() => {
    const pathWorkflow = getWorkflowFromPath(window.location.pathname);
    if (pathWorkflow) return pathWorkflow;
    const saved = localStorage.getItem("activeWorkflow");
    return (saved as WorkflowType) || 'settings';
  });
  const [activeBidTab, setActiveBidTab] = useState(() => {
    return localStorage.getItem("activeBidTab") || "dashboard";
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Sync state to URL and localStorage
  useEffect(() => {
    localStorage.setItem("activeWorkflow", activeWorkflow);
    const targetPath = WORKFLOW_PATHS[activeWorkflow];
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, "", targetPath);
    }
  }, [activeWorkflow]);

  // Sync browser back/forward mechanics
  useEffect(() => {
    const handlePopState = () => {
      const pathWorkflow = getWorkflowFromPath(window.location.pathname);
      if (pathWorkflow) {
        setActiveWorkflow(pathWorkflow);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    localStorage.setItem("activeBidTab", activeBidTab);
  }, [activeBidTab]);

  const handleSyncBidders = async () => {
    setIsSyncing(true);
    const spreadsheetId = config.bidManagementSpreadsheetId;
    
    const toastId = toast.loading("Checking credentials and backing up existing Bid-Management layers...");
    
    try {
      console.log("[Sync] Triggering native Node.js Google Sheets migration...");
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bidders/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          spreadsheetId,
          auctionImportSheetID: config.auctionItemsSpreadsheetId,
          auctionTicketSheetsID: config.auctionTicketsSpreadsheetId
        }),
        credentials: "include"
      });
      
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to setup bid management app");
      
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


  useEffect(() => {
    // Determine initial sidebar state based on screen size
    const isMobile = window.innerWidth < 768;
    setIsSidebarOpen(!isMobile);
  }, []);

  if (authenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 px-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center space-y-1">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShoppingBag className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">ORNS Auction</CardTitle>
            <CardDescription className="text-lg">
              Next-level charity auction management
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-center text-muted-foreground text-sm">
              Manage this year's ORNS Auction with Google Sheets & Drive.
            </p>
            
            <Button onClick={handleLogin} size="lg" className="w-full text-md py-6 shadow-md hover:shadow-lg transition-all gap-3">
              <ShoppingBag className="w-6 h-6" />
              Sign in with @orns.org
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row h-screen md:h-auto overflow-hidden md:overflow-visible">
      {/* Mobile Header */}
      <div className="md:hidden h-16 border-b flex items-center justify-between bg-background shrink-0 font-semibold px-4 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <WalletCards className="w-5 h-5 text-primary" />
          <span className="text-sm font-bold">ORNS Auction</span>
        </div>
        <div className="flex items-center gap-2">
           <span className="text-xs text-muted-foreground font-medium uppercase tracking-tight truncate max-w-[120px]">
             {activeWorkflow === 'items' && "Items"}
             {activeWorkflow === 'tickets' && "Tickets"}
             {activeWorkflow === 'bids' && "Bids"}
             {activeWorkflow === 'settings' && "Config"}
           </span>
           <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
             {isMobileMenuOpen ? <PanelLeftClose className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
           </Button>
        </div>
      </div>

      {/* Overlay for mobile menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/40 z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar Navigation */}
      <aside 
        className={`bg-background border-r border-border shrink-0 flex-col fixed md:sticky inset-y-0 left-0 md:h-screen z-50 flex overflow-hidden transition-all duration-300 shadow-xl md:shadow-none
          ${isMobileMenuOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0'}
          ${isSidebarOpen ? 'md:w-64' : 'md:w-16'}`}
      >
        <div className={`h-16 flex items-center border-b shrink-0 ${isSidebarOpen ? 'px-4 justify-between' : 'justify-center'}`}>
          <div className={`flex items-center gap-2 overflow-hidden whitespace-nowrap ${(!isSidebarOpen && !isMobileMenuOpen) && 'hidden'}`}>
            <WalletCards className="w-6 h-6 shrink-0 text-primary" />
            <span className="text-lg font-bold tracking-tight">ORNS Auction</span>
          </div>
          <Button variant="ghost" size="icon" className={`shrink-0 h-8 w-8 hidden md:flex ${isSidebarOpen ? 'ml-2' : ''}`} onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 md:hidden" onClick={() => setIsMobileMenuOpen(false)}>
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto overflow-x-hidden flex flex-col">
          {(isSidebarOpen || isMobileMenuOpen) && <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Workflows</p>}
          
          <Button 
            variant={activeWorkflow === 'items' ? 'secondary' : 'ghost'} 
            className={`justify-start gap-3 h-10 ${(isSidebarOpen || isMobileMenuOpen) ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={() => { setActiveWorkflow('items'); setIsMobileMenuOpen(false); }}
            title="Auction Items"
          >
            <Package className="w-5 h-5 shrink-0" />
            {(isSidebarOpen || isMobileMenuOpen) && <span className="truncate">Auction Items</span>}
          </Button>

          <Button 
            variant={activeWorkflow === 'tickets' ? 'secondary' : 'ghost'} 
            className={`justify-start gap-3 h-10 ${(isSidebarOpen || isMobileMenuOpen) ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={() => { setActiveWorkflow('tickets'); setIsMobileMenuOpen(false); }}
            title="Auction Tickets"
          >
            <Ticket className="w-5 h-5 shrink-0" />
            {(isSidebarOpen || isMobileMenuOpen) && <span className="truncate">Auction Tickets</span>}
          </Button>
          
          <Button 
            variant={activeWorkflow === 'bids' ? 'secondary' : 'ghost'} 
            className={`justify-start gap-3 h-10 ${(isSidebarOpen || isMobileMenuOpen) ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={() => { setActiveWorkflow('bids'); setIsMobileMenuOpen(false); }}
            title="Bid Management"
          >
            <ClipboardList className="w-5 h-5 shrink-0" />
            {(isSidebarOpen || isMobileMenuOpen) && <span className="truncate">Bid Management</span>}
          </Button>

          <div className="h-6" />
          {(isSidebarOpen || isMobileMenuOpen) && <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">System</p>}

          <Button 
            variant={activeWorkflow === 'settings' ? 'secondary' : 'ghost'} 
            className={`justify-start gap-3 h-10 ${(isSidebarOpen || isMobileMenuOpen) ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={() => { setActiveWorkflow('settings'); setIsMobileMenuOpen(false); }}
            title="Configuration"
          >
            <Settings className="w-5 h-5 shrink-0" />
            {(isSidebarOpen || isMobileMenuOpen) && <span className="truncate">Configuration</span>}
          </Button>
        </div>

        <div className="p-3 border-t shrink-0 flex flex-col items-center">
          <Button 
            variant="ghost" 
            className={`justify-start gap-3 text-muted-foreground hover:text-destructive ${(isSidebarOpen || isMobileMenuOpen) ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={handleLogout}
            title="Sign Out"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {(isSidebarOpen || isMobileMenuOpen) && <span>Sign Out</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="p-4 md:p-10 max-w-7xl mx-auto w-full flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeWorkflow}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeWorkflow === 'tickets' && <AuctionTicketsWorkflow />}
              {activeWorkflow === 'items' && <AuctionItemsWorkflow />}
              
              {activeWorkflow === 'settings' && <ConfigSettings />}
              
              {activeWorkflow === 'bids' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                      <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Bid Management</h2>
                      <p className="text-muted-foreground mt-1 text-sm md:text-base">
                        Everything you need to run the auction!
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
                      {isAuctionClosed && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded-md font-bold text-xs uppercase tracking-wider animate-pulse whitespace-nowrap order-first sm:order-none mb-2 sm:mb-0">
                          <AlertCircle className="w-4 h-4" />
                          Auction Closed
                        </div>
                      )}
                      {!isAuctionClosed && (
                        <>
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
                          <Button
                            onClick={handleSyncBidders}
                            disabled={isSyncing}
                            size="sm"
                            className="gap-2 w-full sm:w-auto shrink-0 bg-slate-900 text-slate-50 hover:bg-slate-900/90"
                          >
                            {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                            {isSyncing ? "Setting up..." : "Set Up Bid Management App"}
                          </Button>
                        </>
                      )}
                      {config.bidManagementSpreadsheetId && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            const spreadId = config.bidManagementSpreadsheetId;
                            if (spreadId) {
                              window.open(`https://docs.google.com/spreadsheets/d/${spreadId}`, "_blank");
                            } else {
                              toast.error("Spreadsheet ID not configured");
                            }
                          }}
                          className="gap-2 w-full sm:w-auto"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Open Spreadsheet
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  <Tabs value={activeBidTab} onValueChange={setActiveBidTab} className="space-y-6">
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
                        <TabsTrigger value="items" className="gap-2 px-4 py-2">
                          <ShoppingBag className="w-4 h-4" />
                          <span className="hidden sm:inline">Items</span>
                        </TabsTrigger>
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
                    <TabsContent value="items" className="m-0 mt-2">
                      <Items />
                    </TabsContent>
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
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <Toaster />
      <BackToTop />
    </div>
  );
}
