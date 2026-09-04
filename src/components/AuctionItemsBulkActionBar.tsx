import { motion, AnimatePresence } from "motion/react";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AuctionItemsBulkActionBarProps {
  selectedItemsCount: number;
  categories: string[];
  onBundle: () => void;
  onSetCategory: (value: string) => void;
  onSetItemType: (value: string) => void;
  onClear: () => void;
}

export function AuctionItemsBulkActionBar({
  selectedItemsCount,
  categories,
  onBundle,
  onSetCategory,
  onSetItemType,
  onClear,
}: AuctionItemsBulkActionBarProps) {
  return (
    <AnimatePresence>
      {selectedItemsCount > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0, x: "-50%" }}
          animate={{ y: 0, opacity: 1, x: "-50%" }}
          exit={{ y: 100, opacity: 0, x: "-50%" }}
          className="fixed bottom-6 left-1/2 z-50 bg-background border-2 border-primary shadow-2xl rounded-2xl px-6 py-4 flex items-center gap-6"
        >
          <div className="flex flex-col">
            <span className="text-sm font-bold text-primary">{selectedItemsCount} items selected</span>
            <span className="text-xxs text-muted-foreground uppercase tracking-wider font-semibold">Bulk Actions</span>
          </div>
          <div className="w-[1px] h-10 bg-border" />
          <div className="flex gap-2">
            <Button size="sm" onClick={onBundle} className="rounded-lg px-4 bg-primary hover:bg-primary/90 flex items-center gap-2">
              <Package className="w-4 h-4" /> Bundle
            </Button>

            <Select onValueChange={onSetCategory}>
              <SelectTrigger className="h-9 w-35 text-xs">
                <SelectValue placeholder="Set Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select onValueChange={onSetItemType}>
              <SelectTrigger className="h-9 w-32.5 text-xs">
                <SelectValue placeholder="Set Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Physical Item">Physical Item</SelectItem>
                <SelectItem value="Certificate">Certificate</SelectItem>
                <SelectItem value="Both">Both</SelectItem>
              </SelectContent>
            </Select>

            <Button size="sm" variant="ghost" onClick={onClear} className="rounded-lg hover:bg-red-50 hover:text-red-600">
              Clear
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
