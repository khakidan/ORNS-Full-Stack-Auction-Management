import { cn } from "@/lib/utils";

interface RowIdTileProps {
  value: string;
  /** Small caption under the box, e.g. "ID" or "Item". */
  caption: string;
  className?: string;
}

/** The number box at the start of a list row (bidder or item number), shared by BidderRow, ItemRow and AuctionItemRow. */
export function RowIdTile({ value, caption, className }: RowIdTileProps) {
  return (
    <div className={cn("w-13 shrink-0 flex flex-col items-center gap-0.5", className)}>
      <div className="w-10 h-10 rounded-md bg-secondary text-secondary-foreground flex items-center justify-center font-mono font-bold text-sm">
        {value}
      </div>
      <span className="text-xxs uppercase text-muted-foreground">{caption}</span>
    </div>
  );
}
