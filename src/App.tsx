/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { getAuthStatus, getAuthUrl, logout } from "@/lib/google-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { Loader2, LayoutDashboard, Users, ShoppingBag, CreditCard, Handshake, WalletCards, Settings, LogOut, FileText, Ticket, Package, ClipboardList, PanelLeftClose, Menu, ArrowUp } from "lucide-react";
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

type WorkflowType = 'tickets' | 'items' | 'bids' | 'settings';

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
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowType>('bids');
  const [activeBidTab, setActiveBidTab] = useState("dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    checkAuth();
    
    const handleAuthSuccess = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        checkAuth();
      }
    };
    window.addEventListener('message', handleAuthSuccess);

    // Polling fallback
    const interval = setInterval(() => {
      if (authenticated === false) {
        checkAuth();
      }
    }, 3000);

    return () => {
      window.removeEventListener('message', handleAuthSuccess);
      clearInterval(interval);
    };
  }, [authenticated]);

  const checkAuth = async () => {
    try {
      const status = await getAuthStatus();
      setAuthenticated(status.authenticated);
    } catch (e) {
      setAuthenticated(false);
    }
  };

  const handleLogin = async () => {
    try {
      console.log("Handle login clicked, fetching auth URL...");
      const response = await getAuthUrl();
      
      if (response.error) {
        console.error("Server returned auth error:", response.error);
        toast.error(`Auth Error: ${response.error}`);
        return;
      }
      
      if (!response.url) {
        console.error("Server returned no URL:", response);
        toast.error("Auth server did not return a login URL.");
        return;
      }

      console.log("Redirecting to:", response.url.substring(0, 50) + "...");
      // Using window.open for OAuth because Google blocks their login page in iframes
      window.open(response.url, "oauth_popup", "width=600,height=700");
    } catch (error) {
      console.error("Login failed with fetch error:", error);
      toast.error("Could not reach auth server. Please check the console for details.");
    }
  };

  const handleLogout = async () => {
    await logout();
    setAuthenticated(false);
  };

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
              Manage this year's ORNS Auction with Style!
            </p>
            <Button onClick={handleLogin} size="lg" className="w-full text-md py-6 shadow-md hover:shadow-lg transition-all">
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar Navigation */}
      <aside 
        className={`bg-background border-r border-border shrink-0 flex-col sticky top-0 md:h-screen z-40 flex overflow-hidden relative transition-all duration-300 ${isSidebarOpen ? 'w-full md:w-64' : 'w-full md:w-16'}`}
      >
        <div className={`h-16 flex items-center border-b shrink-0 ${isSidebarOpen ? 'px-4 justify-between' : 'justify-center'}`}>
          <div className={`flex items-center gap-2 overflow-hidden whitespace-nowrap ${!isSidebarOpen && 'hidden'}`}>
            <WalletCards className="w-6 h-6 shrink-0 text-primary" />
            <AnimatePresence mode="popLayout">
              {isSidebarOpen && (
                <motion.span 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-lg font-bold tracking-tight"
                >
                  ORNS Auction
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <Button variant="ghost" size="icon" className={`shrink-0 h-8 w-8 hidden md:flex ${isSidebarOpen ? 'ml-2' : ''}`} onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>

        <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto overflow-x-hidden flex flex-col">
          {isSidebarOpen && <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Workflows</p>}
          
          <Button 
            variant={activeWorkflow === 'items' ? 'secondary' : 'ghost'} 
            className={`justify-start gap-3 h-10 ${isSidebarOpen ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={() => setActiveWorkflow('items')}
            title="Auction Items Management"
          >
            <Package className="w-5 h-5 shrink-0" />
            {isSidebarOpen && <span className="truncate">Auction Items Management</span>}
          </Button>

          <Button 
            variant={activeWorkflow === 'tickets' ? 'secondary' : 'ghost'} 
            className={`justify-start gap-3 h-10 ${isSidebarOpen ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={() => setActiveWorkflow('tickets')}
            title="Auction Tickets"
          >
            <Ticket className="w-5 h-5 shrink-0" />
            {isSidebarOpen && <span className="truncate">Auction Tickets</span>}
          </Button>
          
          <Button 
            variant={activeWorkflow === 'bids' ? 'secondary' : 'ghost'} 
            className={`justify-start gap-3 h-10 ${isSidebarOpen ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={() => setActiveWorkflow('bids')}
            title="Bid Management"
          >
            <ClipboardList className="w-5 h-5 shrink-0" />
            {isSidebarOpen && <span className="truncate">Bid Management</span>}
          </Button>

          <div className="h-6" />
          {isSidebarOpen && <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">System</p>}

          <Button 
            variant={activeWorkflow === 'settings' ? 'secondary' : 'ghost'} 
            className={`justify-start gap-3 h-10 ${isSidebarOpen ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={() => setActiveWorkflow('settings')}
            title="Configuration"
          >
            <Settings className="w-5 h-5 shrink-0" />
            {isSidebarOpen && <span className="truncate">Configuration</span>}
          </Button>
        </div>

        <div className="p-3 border-t shrink-0 flex flex-col items-center">
          <Button 
            variant="ghost" 
            className={`justify-start gap-3 text-muted-foreground hover:text-destructive ${isSidebarOpen ? 'w-full' : 'w-10 px-0 justify-center'}`} 
            onClick={handleLogout}
            title="Sign Out"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {isSidebarOpen && <span>Sign Out</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top header spacing for mobile, hidden on md since we have sidebar */}
        <div className="md:hidden h-16 border-b flex items-center justify-center bg-background shrink-0 font-semibold px-4 sticky top-0 z-30">
          {activeWorkflow === 'items' && "Auction Items Management"}
          {activeWorkflow === 'tickets' && "Auction Tickets Workflow"}
          {activeWorkflow === 'bids' && "Bid Management Workflow"}
          {activeWorkflow === 'settings' && "System Configuration"}
        </div>

        <div className="p-6 md:p-10 max-w-7xl mx-auto w-full flex-1 min-w-0">
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
                  <div>
                    <h2 className="text-3xl font-bold tracking-tight">Bid Management</h2>
                    <p className="text-muted-foreground mt-2">
                      Run the auction! Track bids, enter silent auction sheets, and manage checkout.
                    </p>
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
                        <TabsTrigger value="bids" className="gap-2 px-4 py-2">
                          <CreditCard className="w-4 h-4" />
                          <span className="hidden sm:inline">Bid Entry</span>
                        </TabsTrigger>
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

                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeBidTab}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                      >
                        <TabsContent value="dashboard" className="m-0 mt-2">
                          <Dashboard />
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
                      </motion.div>
                    </AnimatePresence>
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
