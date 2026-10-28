/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, lazy, Suspense } from "react";
import { useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { motion, AnimatePresence } from "motion/react";
import { BugReportButton } from "./components/BugReportButton";
import { SyncStatusBanner } from "./components/SyncStatusBanner";
import { BackToTop } from "./components/BackToTop";
import { AppSidebar, MobileHeader } from "./components/AppSidebar";
import { AuthLoadingScreen, SignInScreen, VolunteerThanksScreen } from "./components/SignInScreens";
import BidManagementWorkflow from "./components/BidManagementWorkflow";
import { useOutboxReplay } from "./hooks/useOutboxReplay";
import { useWorkflowNavigation } from "./hooks/useWorkflowNavigation";

const ConfigSettings = lazy(() => import("./components/ConfigSettings"));
const AuctionTicketsWorkflow = lazy(() => import("./components/AuctionTicketsWorkflow"));
const AuctionItemsWorkflow = lazy(() => import("./components/AuctionItemsWorkflow"));
const ArchivedAuctionsWorkflow = lazy(() => import("./components/ArchivedAuctionsWorkflow"));

export default function App() {
  const { authenticated, can, signedOutReason, handleLogin } = useAuth();
  const { activeWorkflow, setActiveWorkflow, activeBidTab, setActiveBidTab, isVolunteer } = useWorkflowNavigation();
  // Open with labels on a desktop, icons only on a phone-width screen.
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Sends winning bids saved on this device while offline (Milestone A).
  useOutboxReplay(authenticated === true);

  if (authenticated === null) return <AuthLoadingScreen />;
  if (!authenticated && signedOutReason === "volunteer_access_ended") return <VolunteerThanksScreen />;
  if (!authenticated) return <SignInScreen onSignIn={handleLogin} />;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row h-screen md:h-auto overflow-hidden md:overflow-visible">
      <MobileHeader activeWorkflow={activeWorkflow} isMobileMenuOpen={isMobileMenuOpen} setIsMobileMenuOpen={setIsMobileMenuOpen} />

      <AppSidebar
        activeWorkflow={activeWorkflow}
        onSelect={setActiveWorkflow}
        isVolunteer={isVolunteer}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="p-4 md:p-10 w-full flex-1 min-w-0">
          <SyncStatusBanner onSignIn={handleLogin} />
          <AnimatePresence mode="wait">
            <motion.div
              key={activeWorkflow}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Suspense fallback={<div>Loading...</div>}>
                {activeWorkflow === "tickets" && <AuctionTicketsWorkflow />}
                {activeWorkflow === "items" && <AuctionItemsWorkflow />}
                {activeWorkflow === "settings" && can("settings") && <ConfigSettings />}
                {activeWorkflow === "archive" && <ArchivedAuctionsWorkflow />}
                {activeWorkflow === "bids" && (
                  <BidManagementWorkflow activeBidTab={activeBidTab} onBidTabChange={setActiveBidTab} isVolunteer={isVolunteer} />
                )}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <Toaster />
      <BackToTop />
      <BugReportButton />
    </div>
  );
}
