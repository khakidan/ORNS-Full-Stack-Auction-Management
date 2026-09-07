import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuctionItemFormSection } from "@/components/AuctionItemFormSection";
import { AuctionItem } from "@/types";

interface AddAuctionItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  newItem: Partial<AuctionItem>;
  onNewItemChange: (newItem: Partial<AuctionItem>) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

/**
 * Mirrors EditAuctionItemDialog.tsx's sectioned layout (via the shared
 * AuctionItemFormSection) so Add and Edit read as one visual workflow,
 * per the user's explicit ask - same dialog width, section grouping, and
 * label/input styling. Deliberately keeps a different field set though:
 * no Item # (server-assigned on save) and no editable Opening Bid/Min
 * Raise (both auto-calculated server-side from Value - see
 * itemService.ts's calculateBidAmounts) - those only make sense to
 * expose for manual override once real values exist, in Edit.
 */
export function AddAuctionItemDialog({
  open,
  onOpenChange,
  categories,
  newItem,
  onNewItemChange,
  onSubmit,
  isSubmitting,
}: AddAuctionItemDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Auction Item</DialogTitle>
          <DialogDescription>
            Fill out the details for the new auction item. The ID will be automatically generated based on the category.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 max-h-[65vh] overflow-y-auto pr-1">
          <AuctionItemFormSection title="Details">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Category *</Label>
              <Select
                value={newItem.category}
                onValueChange={(val) => onNewItemChange({ ...newItem, category: val })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Name *</Label>
              <Input
                value={newItem.name}
                onChange={(e) => onNewItemChange({ ...newItem, name: e.target.value })}
                placeholder="Item Name"
              />
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Description</Label>
              <Textarea
                value={newItem.description}
                onChange={(e) => onNewItemChange({ ...newItem, description: e.target.value })}
                placeholder="Item Description"
              />
            </div>
          </AuctionItemFormSection>

          <AuctionItemFormSection title="Pricing">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Value</Label>
              <Input
                value={newItem.value}
                onChange={(e) => onNewItemChange({ ...newItem, value: e.target.value })}
                placeholder="$0.00"
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Opening bid and minimum raise are calculated automatically from this value once saved.
              </p>
            </div>
          </AuctionItemFormSection>

          <AuctionItemFormSection title="Donor & Type">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Donor</Label>
                <Input
                  value={newItem.donor}
                  onChange={(e) => onNewItemChange({ ...newItem, donor: e.target.value })}
                  placeholder="Donor Name"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
                <Select
                  value={newItem.itemType}
                  onValueChange={(val) => onNewItemChange({ ...newItem, itemType: val })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Physical Item">Physical Item</SelectItem>
                    <SelectItem value="Certificate">Certificate</SelectItem>
                    <SelectItem value="Both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Checkbox
                id="allowMultipleWinners"
                checked={!!newItem.allowMultipleWinners}
                onCheckedChange={(checked) => onNewItemChange({ ...newItem, allowMultipleWinners: checked === true })}
              />
              <Label htmlFor="allowMultipleWinners" className="text-sm font-normal cursor-pointer">
                Allow Multiple Winners
              </Label>
            </div>
          </AuctionItemFormSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton onClick={onSubmit} loading={isSubmitting}>
            Save Item
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
