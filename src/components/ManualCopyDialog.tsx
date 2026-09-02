import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ManualCopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auctionYear: number | null;
}

export default function ManualCopyDialog({ open, onOpenChange, auctionYear }: ManualCopyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manual Copy Required</DialogTitle>
          <DialogDescription>
            Because these files require custom historical data, they are not auto-copied. Once your new folder is generated, please manually copy the following from last year's folder:
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <ul className="list-disc pl-6 space-y-2 text-sm text-foreground font-medium">
            <li>Auction Donation List {auctionYear}</li>
            <li>Auction {auctionYear} Ideas</li>
          </ul>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>I have confirmed</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
