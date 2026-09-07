import { useState } from "react";
import { useAuction } from "@/context/AuctionContext";
import { cn } from "@/lib/utils";
import { LayoutGrid, Zap } from "lucide-react";
import { QuickBidEntry } from "@/components/QuickBidEntry";
import { BatchBidEntry } from "@/components/BatchBidEntry";

type BidEntryMode = "quick" | "batch";

/**
 * Two modes for two different moments in the auction, per the user's own
 * description of how bids actually reach them - a handful trickle in
 * during the first two waves, then a much larger 30-60 item wave hits at
 * once. Quick Entry (keyboard-driven, one record at a time, with a live
 * session feed) suits the smaller waves; Batch Entry (a spreadsheet-style
 * grid, nothing recorded until reviewed) suits the big one. Both call the
 * exact same recordWinningBid path - no backend changes needed for
 * either mode. See docs/agents/CHANGELOG.md for the full design history
 * (an approved Artifact mockup preceded this implementation).
 */
export default function BidEntry() {
  const { bidders, items, winners, recordWinningBid } = useAuction();
  const [mode, setMode] = useState<BidEntryMode>("quick");

  return (
    <div className="space-y-4">
      <div className="inline-flex gap-1 bg-muted p-1 rounded-lg">
        <button
          type="button"
          onClick={() => setMode("quick")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors",
            mode === "quick" ? "bg-background shadow-sm" : "text-muted-foreground"
          )}
        >
          <Zap className="w-4 h-4" /> Quick Entry
        </button>
        <button
          type="button"
          onClick={() => setMode("batch")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors",
            mode === "batch" ? "bg-background shadow-sm" : "text-muted-foreground"
          )}
        >
          <LayoutGrid className="w-4 h-4" /> Batch Entry
          <span className="text-xs font-normal opacity-70">for the big wave</span>
        </button>
      </div>

      {mode === "quick" ? (
        <QuickBidEntry items={items} bidders={bidders} winners={winners} recordWinningBid={recordWinningBid} />
      ) : (
        <BatchBidEntry items={items} bidders={bidders} winners={winners} recordWinningBid={recordWinningBid} />
      )}
    </div>
  );
}
