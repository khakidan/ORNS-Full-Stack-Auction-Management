import { ReactNode } from "react";
import { Archive, ClipboardList, LogOut, Menu, Package, PanelLeftClose, Settings, Ticket, WalletCards } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { SavedBidsSidebarBadge } from "./SyncStatusBanner";
import { WORKFLOW_LABELS, WorkflowType } from "@/hooks/useWorkflowNavigation";

interface AppSidebarProps {
  activeWorkflow: WorkflowType;
  onSelect: (workflow: WorkflowType) => void;
  isVolunteer: boolean;
  /** Desktop: full width with labels, or icons only. */
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

/** The phone-width bar above the page: the app name, the current workflow, and the menu button. */
export function MobileHeader({ activeWorkflow, isMobileMenuOpen, setIsMobileMenuOpen }: Pick<AppSidebarProps, "activeWorkflow" | "isMobileMenuOpen" | "setIsMobileMenuOpen">) {
  return (
    <div className="md:hidden h-16 border-b flex items-center justify-between bg-background shrink-0 font-semibold px-4 sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <WalletCards className="w-5 h-5 text-primary" />
        <span className="text-sm font-bold">ORNS Auction</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-tight truncate max-w-30">
          {WORKFLOW_LABELS[activeWorkflow]}
        </span>
        <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <PanelLeftClose className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * The left-hand navigation: the workflows this person may open (a
 * volunteer sees only Bid Management; Settings needs the `settings`
 * capability), who is signed in, and Sign Out.
 */
export function AppSidebar({ activeWorkflow, onSelect, isVolunteer, isSidebarOpen, onToggleSidebar, isMobileMenuOpen, setIsMobileMenuOpen }: AppSidebarProps) {
  const { user, can, handleLogout } = useAuth();
  const expanded = isSidebarOpen || isMobileMenuOpen;

  const navButton = (workflow: WorkflowType, title: string, icon: ReactNode) => (
    <Button
      variant={activeWorkflow === workflow ? "secondary" : "ghost"}
      className={cn("justify-start gap-3 h-10", expanded ? "w-full" : "w-10 px-0 justify-center")}
      onClick={() => { onSelect(workflow); setIsMobileMenuOpen(false); }}
      title={title}
    >
      {icon}
      {expanded && <span className="truncate">{title}</span>}
    </Button>
  );

  return (
    <>
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

      <aside
        className={cn(
          "bg-background border-r border-border shrink-0 flex-col fixed md:sticky inset-y-0 left-0 md:h-screen z-50 flex overflow-hidden transition-all duration-300 shadow-xl md:shadow-none",
          isMobileMenuOpen ? "translate-x-0 w-max" : "-translate-x-full md:translate-x-0",
          isSidebarOpen ? "md:w-max" : "md:w-16"
        )}
      >
        <div className={cn("h-16 flex items-center border-b shrink-0 gap-2", expanded ? "px-4 w-max" : "justify-center")}>
          {expanded && <span className="text-lg font-bold tracking-tight truncate">ORNS Auction</span>}
          <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 hidden md:flex" onClick={onToggleSidebar}>
            {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 md:hidden" onClick={() => setIsMobileMenuOpen(false)}>
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        <div className={cn("flex-1 py-6 px-3 space-y-1 overflow-y-auto overflow-x-hidden flex flex-col", expanded && "w-max")}>
          {expanded && <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Workflows</p>}

          {!isVolunteer && (<>
            {navButton("items", "Auction Items", <Package className="w-5 h-5 shrink-0" />)}
            {navButton("tickets", "Auction Tickets", <Ticket className="w-5 h-5 shrink-0" />)}
          </>)}

          {navButton("bids", "Bid Management", <ClipboardList className="w-5 h-5 shrink-0" />)}

          {!isVolunteer && (<>
            <div className="h-6" />
            {expanded && <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">System</p>}
            {navButton("archive", "Archived Auctions", <Archive className="w-5 h-5 shrink-0" />)}
          </>)}

          {can("settings") && navButton("settings", "Settings", <Settings className="w-5 h-5 shrink-0" />)}
        </div>

        <div className="p-3 border-t shrink-0 flex flex-col items-center">
          <SavedBidsSidebarBadge expanded={expanded} />
          {user && expanded && (
            <div className="w-full px-3 pb-2 text-xs" data-testid="signed-in-user">
              <div className="truncate font-medium" title={user.email}>{user.email}</div>
              <div className="text-muted-foreground">{user.roleLabel}</div>
            </div>
          )}
          <Button
            variant="ghost"
            className={cn("justify-start gap-3 text-muted-foreground hover:text-destructive", expanded ? "w-full" : "w-10 px-0 justify-center")}
            onClick={handleLogout}
            title="Sign Out"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {expanded && <span>Sign Out</span>}
          </Button>
        </div>
      </aside>
    </>
  );
}
