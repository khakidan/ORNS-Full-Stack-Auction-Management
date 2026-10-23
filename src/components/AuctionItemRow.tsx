import { motion } from "motion/react";
import { Heart, Package, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/badge";
import { AuctionItem } from "@/types";
import { categoryBadgeClass, ITEM_TYPE_STYLES } from "@/lib/itemBadgeColors";
import { cn } from "@/lib/utils";
import { RowIdTile } from "@/components/RowIdTile";

interface AuctionItemRowProps {
  item: AuctionItem;
  isSelected: boolean;
  onToggleSelect: (rowIndex: number) => void;
  onEditRequest: (item: AuctionItem) => void;
  isAuctionClosed: boolean;
  isExecutingRestore: boolean;
  restoreBundleId: string | null;
  onRestoreBundle: (bundleId: string) => void;
  onDeleteRequest: (item: AuctionItem) => void;
}

/**
 * Redesigned to match ItemRow.tsx's row-based visual language (see
 * CHANGELOG.md's "UI / Layout Tweaks" item - the user asked
 * to bring the read-only Bid Management "Items" tab's layout here too),
 * replacing the old <table> row with 9 separate per-field EditableCell
 * inline editors. All the same editing/delete/bundle functionality is
 * preserved - editing now opens EditAuctionItemDialog.tsx (one form, one
 * Save, mirroring EditAttendeeDialog.tsx's pattern on the Attendee List)
 * instead of 9 separate inline pencil-icons. Selection/delete/bundle
 * restore stay as direct row actions, since those are still single-click
 * operations, not multi-field edits.
 */
export function AuctionItemRow({
  item,
  isSelected,
  onToggleSelect,
  onEditRequest,
  isAuctionClosed,
  isExecutingRestore,
  restoreBundleId,
  onRestoreBundle,
  onDeleteRequest,
}: AuctionItemRowProps) {
  const hasFinancials = !!(item.value || item.openingBid || item.minRaise || item.donor);
  const isBundled = !!item.bundleId && item.status === "Active";
  const typeStyle = item.itemType ? ITEM_TYPE_STYLES[item.itemType] : undefined;
  const TypeIcon = typeStyle?.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      data-testid={`auction-item-row-${item.rowIndex}`}
      className={cn(
        "group/row flex items-start gap-4 px-5 py-4 border-b last:border-0 hover:bg-muted/50 transition-colors",
        isSelected && "bg-primary/5"
      )}
    >
      <div className="pt-1">
        <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(item.rowIndex)} />
      </div>

      <RowIdTile value={item.id} caption="Item" className="pt-0.5" />

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-row-title">{item.name || <span className="italic text-muted-foreground">Untitled item</span>}</span>
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

        {isBundled && !isAuctionClosed && (
          <LoadingButton
            size="sm"
            variant="outline"
            className="h-7 text-xxs gap-1 px-2 border-purple-200 text-purple-700 hover:bg-purple-100 hover:text-purple-800 transition-colors w-fit mt-0.5"
            loading={isExecutingRestore && restoreBundleId === item.bundleId}
            disabled={isExecutingRestore}
            icon={<RotateCcw className="w-3 h-3" />}
            loaderClassName="w-3 h-3"
            onClick={() => onRestoreBundle(item.bundleId)}
          >
            Restore Items
          </LoadingButton>
        )}
      </div>

      {!isAuctionClosed && (
        <div className="flex gap-1 shrink-0 pt-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity">
          <IconButton
            variant="ghost"
            aria-label={`Edit ${item.name || "item"}`}
            icon={<Pencil className="w-3.5 h-3.5" />}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => onEditRequest(item)}
          />
          <IconButton
            variant="ghost"
            aria-label={`Delete ${item.name || "item"}`}
            icon={<Trash2 className="w-3.5 h-3.5" />}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onDeleteRequest(item)}
          />
        </div>
      )}
    </motion.div>
  );
}
