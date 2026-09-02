// src/components/BidEntry.tsx
import { useState } from "react";
import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { getSheetData, updateSheetData } from "@/lib/google-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { toast } from "sonner";
import { Gavel, Search, User } from "lucide-react";
import { cn } from "@/lib/utils";

export default function BidEntry() {
  const { bidders, items, recordWinningBid } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;

  const [itemId, setItemId] = useState("");
  const [bidderId, setBidderId] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedItem = items.find(i => i.id === itemId);
  const selectedBidder = bidders.find(b => b.id === bidderId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) {
      toast.error("Please fill in a valid item number");
      return;
    } else if (!selectedBidder) {
      toast.error("Please fill in a valid bidder number");
      return;
    } else if (!price) {
      toast.error("Please fill all fields");
      return;
    }

    if (!selectedBidder.checkedIn && !selectedBidder.isProxy) {
      toast.error("Bidder must be checked in (or be a proxy bidder)");
      return;
    }

    setSubmitting(true);
    try {
      if (!spreadsheetId) {
        toast.error("Bid Management Spreadsheet ID not configured correctly.");
        return;
      }
      
      await recordWinningBid(bidderId, itemId, parseFloat(price));

      toast.success(`Bid recorded for ${selectedBidder.firstName} — ${selectedItem.name}`);
      setItemId(""); setBidderId(""); setPrice("");
    } catch (err: any) {
      toast.error(err.message || "Failed to record bid. UI was rolled back.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="max-w-xl mx-auto">
      <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Gavel className="w-6 h-6" /> Winning Bid Entry
            </div>
          </CardTitle>
          <CardDescription>Live auction data entry — matches your original workflow</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Item ID */}
          <div>
            <Label>Item Number</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="e.g. 1301"
                value={itemId}
                onChange={e => setItemId(e.target.value)}
                autoFocus
                disabled={submitting}
              />
            </div>
            {selectedItem && <p className="text-sm text-green-600 mt-1">{selectedItem.name}</p>}
          </div>

          {/* Bidder ID */}
          <div>
            <Label>Bidder ID</Label>
            <div className="relative">
              <User className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input className="pl-10" placeholder="e.g. 142" value={bidderId} onChange={e => setBidderId(e.target.value)} disabled={submitting} />
            </div>
            {selectedBidder && (
              <p className={cn("text-sm mt-1", selectedBidder.checkedIn ? "text-green-600" : "text-amber-600")}>
                {selectedBidder.firstName} {selectedBidder.lastName}
                {!selectedBidder.checkedIn && !selectedBidder.isProxy && " — NOT CHECKED IN"}
              </p>
            )}
          </div>

          {/* Price */}
          <div>
            <Label>Winning Bid ($)</Label>
            <Input type="number" step="0.01" placeholder="150.00" value={price} onChange={e => setPrice(e.target.value)} disabled={submitting} />
          </div>

          <LoadingButton type="submit" className="w-full h-12 text-lg" loading={submitting} loadingText={null} loaderClassName="">
            Record Winning Bid
          </LoadingButton>
        </form>
      </CardContent>
    </Card>
  );
}