import { motion } from "motion/react";
import { Loader2, Package, RotateCcw, Trash2 } from "lucide-react";
import { TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/badge";
import { EditableCell } from "@/components/ui/EditableCell";
import { AuctionItem } from "@/types";
import { cn } from "@/lib/utils";

interface AuctionItemRowProps {
  item: AuctionItem;
  isSelected: boolean;
  onToggleSelect: (rowIndex: number) => void;
  onUpdate: (rowIndex: number, field: keyof AuctionItem, colLetter: string, value: string) => void;
  isAuctionClosed: boolean;
  categories: string[];
  isExecutingRestore: boolean;
  restoreBundleId: string | null;
  onRestoreBundle: (bundleId: string) => void;
  onDeleteRequest: (item: AuctionItem) => void;
}

export function AuctionItemRow({
  item,
  isSelected,
  onToggleSelect,
  onUpdate,
  isAuctionClosed,
  categories,
  isExecutingRestore,
  restoreBundleId,
  onRestoreBundle,
  onDeleteRequest,
}: AuctionItemRowProps) {
  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn("group/row border-b transition-colors", isSelected && "bg-primary/5")}
    >
      <TableCell className="px-2 align-top pt-4">
        <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(item.rowIndex)} />
      </TableCell>
      <TableCell className="font-mono text-xs align-top">
        <EditableCell
          value={item.id}
          onSave={(val) => onUpdate(item.rowIndex, "id", "A", val)}
          disabled={isAuctionClosed}
        />
      </TableCell>
      <TableCell className="align-top">
        <div className="space-y-3">
          <div className="font-medium text-base text-foreground">
            <EditableCell
              value={item.name}
              onSave={(val) => onUpdate(item.rowIndex, "name", "C", val)}
              disabled={isAuctionClosed}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            <EditableCell
              type="textarea"
              value={item.description}
              onSave={(val) => onUpdate(item.rowIndex, "description", "D", val)}
              disabled={isAuctionClosed}
            />
          </div>
        </div>
      </TableCell>
      <TableCell className="align-top text-sm">
        <EditableCell
          type="select"
          options={categories}
          value={item.category}
          onSave={(val) => onUpdate(item.rowIndex, "category", "B", val)}
          disabled={isAuctionClosed}
        />
      </TableCell>
      <TableCell className="align-top text-sm space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-12 shrink-0">Value:</span>
          <EditableCell
            value={item.value}
            onSave={(val) => onUpdate(item.rowIndex, "value", "E", val)}
            disabled={isAuctionClosed}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-12 shrink-0">Open:</span>
          <EditableCell
            value={item.openingBid}
            onSave={(val) => onUpdate(item.rowIndex, "openingBid", "F", val)}
            disabled={isAuctionClosed}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-12 shrink-0">Raise:</span>
          <EditableCell
            value={item.minRaise}
            onSave={(val) => onUpdate(item.rowIndex, "minRaise", "G", val)}
            disabled={isAuctionClosed}
          />
        </div>
      </TableCell>
      <TableCell className="align-top text-sm">
        <EditableCell
          value={item.donor}
          onSave={(val) => onUpdate(item.rowIndex, "donor", "H", val)}
          disabled={isAuctionClosed}
        />
      </TableCell>
      <TableCell className="align-top text-sm">
        <EditableCell
          type="select"
          options={["Physical Item", "Certificate", "Both"]}
          value={item.itemType}
          onSave={(val) => onUpdate(item.rowIndex, "itemType", "I", val)}
          disabled={isAuctionClosed}
        />
        {item.bundleId && item.status === "Active" && (
          <div className="mt-4 flex flex-col gap-2">
            <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 w-fit">
              <Package className="w-3 h-3 mr-1" />
              Bundle
            </Badge>
            {!isAuctionClosed && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xxs gap-1 px-2 border-purple-200 text-purple-700 hover:bg-purple-200 hover:text-purple-800 transition-colors w-fit"
                disabled={isExecutingRestore}
                onClick={() => onRestoreBundle(item.bundleId)}
              >
                {isExecutingRestore && restoreBundleId === item.bundleId ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                Restore Items
              </Button>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="align-top text-center px-2">
        {!isAuctionClosed && (
          <IconButton
            variant="ghost"
            aria-label={`Delete ${item.name || "item"}`}
            icon={<Trash2 className="h-4 w-4" />}
            className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 transition-opacity"
            onClick={() => onDeleteRequest(item)}
          />
        )}
      </TableCell>
    </motion.tr>
  );
}
