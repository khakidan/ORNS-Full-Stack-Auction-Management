import { AlertCircle, CircleDot, Hammer } from "lucide-react";
import { AuctionState } from "@/lib/auctionState";
import { cn } from "@/lib/utils";

const BADGES: Record<AuctionState, { label: string; className: string; Icon: typeof AlertCircle }> = {
  prep: { label: "Prep Mode", className: "bg-slate-100 text-slate-600 border-slate-200", Icon: Hammer },
  live: { label: "Auction Live", className: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CircleDot },
  closed: { label: "Auction Closed", className: "bg-amber-100 text-amber-700 border-amber-200 animate-pulse", Icon: AlertCircle },
};

/** The Prep / Live / Closed badge shown in every page header. */
export function AuctionStateBadge({ state, className }: { state: AuctionState; className?: string }) {
  const { label, className: tone, Icon } = BADGES[state];
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1 border rounded-md font-bold text-xs uppercase tracking-wider whitespace-nowrap", tone, className)}>
      <Icon className="w-4 h-4" />
      {label}
    </div>
  );
}
