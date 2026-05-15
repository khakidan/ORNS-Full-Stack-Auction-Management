// src/components/BidEntry.tsx
import { useState } from "react";
import { useAuction } from "@/hooks/useAuction";
import { getSheetData, updateSheetData } from "@/lib/google-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Gavel, Loader2, RefreshCw, Search, User } from "lucide-react";

export default function BidEntry() {
  const { bidders, items } = useAuction();
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
      const spreadsheetId = localStorage.getItem("spreadsheetId");
      if (!spreadsheetId || spreadsheetId === "undefined" || spreadsheetId === "null" || spreadsheetId.includes("PASTE")) {
        toast.error("Bid Management Spreadsheet ID not configured correctly.");
        return;
      }
      const sheetName = localStorage.getItem("bidManagementSheet") || "Bid-Management";

      const data = await getSheetData(spreadsheetId, `${sheetName}!1:200`);
      if (!data.values || data.values.length === 0) {
        throw new Error("Bid Management sheet is empty or inaccessible. Please ensure headers are set up.");
      }

      // Find bidder column
      const header = data.values[0];
      let colIndex = -1;
      for (let j = 0; j < header.length; j += 2) {
        if (header[j]?.toString() === bidderId) {
          colIndex = j;
          break;
        }
      }
      if (colIndex === -1) throw new Error("Bidder column not found in Bid-Management sheet");

      // Find next empty row in that column (starting row 4)
      let rowIndex = -1;
      for (let i = 3; i < data.values.length; i++) {
        const row = data.values[i];
        if (!row || !row[colIndex]) {
          rowIndex = i + 1;
          break;
        }
      }
      if (rowIndex === -1) rowIndex = data.values.length + 1;
      if (rowIndex < 4) rowIndex = 4; // Ensure we don't overwrite headers if sheet is mostly empty

      const getColumnLetter = (index: number): string => {
        let letter = "";
        while (index >= 0) {
          letter = String.fromCharCode((index % 26) + 65) + letter;
          index = Math.floor(index / 26) - 1;
        }
        return letter;
      };

      const colLetter = getColumnLetter(colIndex);
      const nextColLetter = getColumnLetter(colIndex + 1);

      await updateSheetData(spreadsheetId!, `${sheetName}!${colLetter}${rowIndex}:${nextColLetter}${rowIndex}`, [
        [itemId, parseFloat(price)]
      ]);

      toast.success(`Bid recorded for ${selectedBidder.firstName} — ${selectedItem.name}`);
      setItemId(""); setBidderId(""); setPrice("");
    } catch (err: any) {
      toast.error(err.message || "Failed to record bid");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="max-w-xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3">
            <Gavel className="w-6 h-6" /> Winning Bid Entry
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => {
              const spreadId = localStorage.getItem("spreadsheetId");
              if (spreadId && !spreadId.includes("PASTE")) {
                window.open(`https://docs.google.com/spreadsheets/d/${spreadId}`, "_blank");
              } else {
                toast.error("Spreadsheet ID not configured");
              }
            }}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Open Spreadsheet
          </Button>
        </div>
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
              />
            </div>
            {selectedItem && <p className="text-sm text-green-600 mt-1">{selectedItem.name}</p>}
          </div>

          {/* Bidder ID */}
          <div>
            <Label>Bidder ID</Label>
            <div className="relative">
              <User className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Input className="pl-10" placeholder="e.g. 142" value={bidderId} onChange={e => setBidderId(e.target.value)} />
            </div>
            {selectedBidder && (
              <p className={`text-sm mt-1 ${selectedBidder.checkedIn ? 'text-green-600' : 'text-amber-600'}`}>
                {selectedBidder.firstName} {selectedBidder.lastName}
                {!selectedBidder.checkedIn && !selectedBidder.isProxy && " — NOT CHECKED IN"}
              </p>
            )}
          </div>

          {/* Price */}
          <div>
            <Label>Winning Bid ($)</Label>
            <Input type="number" step="0.01" placeholder="150.00" value={price} onChange={e => setPrice(e.target.value)} />
          </div>

          <Button type="submit" className="w-full h-12 text-lg" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : "Record Winning Bid"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}