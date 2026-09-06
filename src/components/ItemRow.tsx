import { Package, Trophy, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AuctionItem } from "@/types";

interface ItemRowProps {
  item: AuctionItem;
  winnerName?: string;
}

/**
 * Redesigned to match AttendeeRow.tsx/BidderRow.tsx's row-based visual
 * language (see refactor-opportunities.md's "UI / Layout Tweaks" item)
 * instead of the old bare 4-column <table> row, which only ever surfaced
 * id/name/category/winner even though every item already carries a
 * description, value/opening bid/min raise, donor, item type, and bundle
 * status. All of that was previously invisible in this read-only catalog
 * view - now shown, degrading cleanly (a field's line simply doesn't
 * render) when a given item doesn't have it. Purely a display page - no
 * per-row actions, so there's no hover-reveal button block like
 * BidderRow.tsx has, and no enter/exit animation either - matches
 * AttendeeRow.tsx's plain-div convention, since (unlike BidderRow.tsx,
 * which preserved its pre-existing motion.tr) the old table row this
 * replaces never animated either.
 */
export function ItemRow({ item, winnerName }: ItemRowProps) {
  const hasFinancials = !!(item.value || item.openingBid || item.minRaise);
  const isBundled = !!item.bundleId && item.status === "Active";

  return (
    <div
      data-testid={`item-row-${item.id}`}
      className="group/row flex items-start gap-4 px-5 py-4 border-b last:border-0 hover:bg-muted/50 transition-colors"
    >
      <div className="w-13 shrink-0 flex flex-col items-center gap-0.5 pt-0.5">
        <div className="w-10 h-10 rounded-md bg-secondary text-secondary-foreground flex items-center justify-center font-mono font-bold text-sm">
          {item.id}
        </div>
        <span className="text-[10px] uppercase text-muted-foreground">Item</span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[15px]">{item.name}</span>
          {item.category && (
            <Badge variant="outline" className="text-xs font-normal">
              {item.category}
            </Badge>
          )}
          {isBundled && (
            <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 w-fit text-xs font-normal">
              <Package className="w-3 h-3 mr-1" /> Bundle
            </Badge>
          )}
        </div>

        {item.description && (
          <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
        )}

        {hasFinancials && (
          <div className="flex items-center gap-3.5 flex-wrap text-sm text-muted-foreground">
            {item.value && <span>Value: <span className="font-medium text-foreground">{item.value}</span></span>}
            {item.openingBid && <span>Opening: <span className="font-medium text-foreground">{item.openingBid}</span></span>}
            {item.minRaise && <span>Raise: <span className="font-medium text-foreground">{item.minRaise}</span></span>}
            {item.itemType && <span>{item.itemType}</span>}
          </div>
        )}

        {item.donor && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="w-3.5 h-3.5 shrink-0" />
            {item.donor}
          </div>
        )}
      </div>

      <div className="w-40 shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
        <span className="text-[10px] uppercase text-muted-foreground">Winner</span>
        {winnerName ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 text-xs font-semibold max-w-full">
            <Trophy className="w-3 h-3 shrink-0" />
            <span className="truncate">{winnerName}</span>
          </span>
        ) : (
          <span className="text-muted-foreground text-sm italic">Not yet won</span>
        )}
      </div>
    </div>
  );
}
