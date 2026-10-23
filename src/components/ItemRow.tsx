import { Heart, Package, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AuctionItem } from "@/types";
import { cn } from "@/lib/utils";
import { categoryBadgeClass, ITEM_TYPE_STYLES } from "@/lib/itemBadgeColors";
import { RowIdTile } from "@/components/RowIdTile";

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
 * render) when a given item doesn't have it. Category/itemType/Bundle are
 * all Badges on one line (category color-hashed per name since it's
 * free-text; itemType from a fixed color/icon map since it's a 3-value
 * enum; Bundle always purple, matching AuctionItemRow.tsx's convention on
 * the separate editable Auction Items workflow) - refined per user
 * feedback after the first pass put itemType as plain text and donor on
 * its own line instead of inline with Value/Opening/Raise. Purely a
 * display page - no per-row actions, so there's no hover-reveal button
 * block like BidderRow.tsx has, and no enter/exit animation either -
 * matches AttendeeRow.tsx's plain-div convention, since (unlike
 * BidderRow.tsx, which preserved its pre-existing motion.tr) the old
 * table row this replaces never animated either.
 */
export function ItemRow({ item, winnerName }: ItemRowProps) {
  const hasFinancials = !!(item.value || item.openingBid || item.minRaise || item.donor);
  const isBundled = !!item.bundleId && item.status === "Active";
  const typeStyle = item.itemType ? ITEM_TYPE_STYLES[item.itemType] : undefined;
  const TypeIcon = typeStyle?.icon;

  return (
    <div
      data-testid={`item-row-${item.id}`}
      className="group/row flex items-start gap-4 px-5 py-4 border-b last:border-0 hover:bg-muted/50 transition-colors"
    >
      <RowIdTile value={item.id} caption="Item" className="pt-0.5" />

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-row-title">{item.name}</span>
          {item.category && (
            <Badge variant="outline" className={cn("text-xs font-normal", categoryBadgeClass(item.category))}>
              {item.category}
            </Badge>
          )}
          {typeStyle && TypeIcon && (
            <Badge variant="outline" className={cn("text-xs font-normal", typeStyle.className)}>
              <TypeIcon className="w-3 h-3 mr-1" /> {item.itemType}
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
            {item.donor && (
              <span className="flex items-center gap-1">
                <Heart className="w-3.5 h-3.5 shrink-0" />
                {item.donor}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="w-40 shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
        <span className="text-xxs uppercase text-muted-foreground">Winner</span>
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
