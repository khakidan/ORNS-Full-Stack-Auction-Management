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
      <DialogContent className="sm:max-w-[600px] overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Add New Auction Item</DialogTitle>
          <DialogDescription>
            Fill out the details for the new auction item. The ID will be automatically generated based on the category.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right">
              Category *
            </Label>
            <div className="col-span-3">
              <Select
                value={newItem.category}
                onValueChange={(val) => onNewItemChange({ ...newItem, category: val })}
              >
                <SelectTrigger>
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
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Name *
            </Label>
            <div className="col-span-3">
              <Input
                id="name"
                value={newItem.name}
                onChange={(e) => onNewItemChange({ ...newItem, name: e.target.value })}
                placeholder="Item Name"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">
              Description
            </Label>
            <div className="col-span-3">
              <Textarea
                id="description"
                value={newItem.description}
                onChange={(e) => onNewItemChange({ ...newItem, description: e.target.value })}
                placeholder="Item Description"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="value" className="text-right">
              Value
            </Label>
            <div className="col-span-3">
              <Input
                id="value"
                value={newItem.value}
                onChange={(e) => onNewItemChange({ ...newItem, value: e.target.value })}
                placeholder="$0.00"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="donor" className="text-right">
              Donor
            </Label>
            <div className="col-span-3">
              <Input
                id="donor"
                value={newItem.donor}
                onChange={(e) => onNewItemChange({ ...newItem, donor: e.target.value })}
                placeholder="Donor Name"
              />
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="itemType" className="text-right">
              Type
            </Label>
            <div className="col-span-3">
              <Select
                value={newItem.itemType}
                onValueChange={(val) => onNewItemChange({ ...newItem, itemType: val })}
              >
                <SelectTrigger>
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
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="allowMultipleWinners" className="text-right">
              Allow Multiple Winners
            </Label>
            <div className="col-span-3 flex items-center gap-2">
              <Checkbox
                id="allowMultipleWinners"
                checked={!!newItem.allowMultipleWinners}
                onCheckedChange={(checked) => onNewItemChange({ ...newItem, allowMultipleWinners: checked === true })}
              />
              <span className="text-xs text-muted-foreground">
                For repeatable pledge/ticket-style items (raffle tickets, Open Appeal) - almost every real lot should stay unchecked.
              </span>
            </div>
          </div>
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
