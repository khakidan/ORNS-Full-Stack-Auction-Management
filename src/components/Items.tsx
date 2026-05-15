import { useState } from "react";
import { useAuction } from "@/hooks/useAuction";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tag, Search, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSheetData, updateSheetData, clearSheetData } from "@/lib/google-api";
import { toast } from "sonner";

const RESERVED_IDS = [
  '1401', '1501', '1502', '1503', '1504', 
  '1601', '1602', '1603', '1604', '1605', '1606'
];

export default function Items() {
  const { items, winners, loading, fetchItems } = useAuction();
  const [searchTerm, setSearchTerm] = useState("");
  const [syncing, setSyncing] = useState(false);

  const filteredItems = items.filter(item =>
    item.id.toString().includes(searchTerm) ||
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const syncAuctionItems = async () => {
    const sourceSId = localStorage.getItem("auctionItemsSpreadsheetId");
    const targetSId = localStorage.getItem("spreadsheetId");
    const sourceSheetName = localStorage.getItem("auctionItemsSheet") || "Auction-Items";
    
    if (!sourceSId || !targetSId) {
      toast.error("Spreadsheet IDs not configured in Settings");
      return;
    }

    setSyncing(true);
    try {
      // 1. Fetch source items (Data Entry sheet)
      // A: ID (0), B: Category (1), D: Name (3), J: PhyOrCert/Type (9)
      const sourceData = await getSheetData(sourceSId, `${sourceSheetName}!A:J`);
      if (!sourceData.values || sourceData.values.length <= 1) {
        throw new Error("No items found in source spreadsheet");
      }

      const sourceItems = sourceData.values.slice(1).map((row: any[]) => ({
        id: row[0]?.toString() || "",
        type: row[9]?.toString() || "", // Column J is index 9
        name: row[3]?.toString() || ""  // Column D is index 3
      })).filter(item => item.id && !RESERVED_IDS.includes(item.id));

      // 2. Fetch current target items (to preserve reserved ones)
      // We already have some in 'items' from useAuction, but let's fetch full rows to be safe
      const targetData = await getSheetData(targetSId, `${sourceSheetName}!A:C`);
      const reservedItems = (targetData.values || []).slice(1)
        .map((row: any[]) => ({
          id: row[0]?.toString() || "",
          name: row[1]?.toString() || "",
          type: row[2]?.toString() || ""
        }))
        .filter(item => RESERVED_IDS.includes(item.id));

      // 3. Combine and Sort
      const combined = [...reservedItems, ...sourceItems].sort((a, b) => {
        const idA = parseInt(a.id) || 0;
        const idB = parseInt(b.id) || 0;
        return idA - idB;
      });

      // 4. Prepare data for update
      // We write to A:C (ID, Name, Type)
      const values = combined.map(item => [item.id, item.name, item.type]);

      // 5. Clear and Update
      await clearSheetData(targetSId, `${sourceSheetName}!A1:C500`);
      // Update headers
      await updateSheetData(targetSId, `${sourceSheetName}!A1:C1`, [["ID", "Item Name", "Type"]]);
      // Update data
      await updateSheetData(targetSId, `${sourceSheetName}!A2:C${values.length + 1}`, values);

      toast.success("Auction items synced successfully!");
      fetchItems();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to sync auction items");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-1 items-center gap-4 w-full">
          <div className="relative flex-1 md:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search items by box number or name..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Button 
            variant="outline" 
            onClick={syncAuctionItems} 
            disabled={syncing}
            className="gap-2 border-[#e31b23]/30 text-[#e31b23] hover:bg-[#e31b23]/5"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sync Auction Items
          </Button>
        </div>
        <div className="text-sm font-medium text-muted-foreground bg-white px-3 py-1.5 rounded border border-slate-200 shadow-sm">
          Total Items: <span className="text-[#e31b23] font-bold">{items.length}</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-primary" />
                Auction Catalog
              </CardTitle>
              <CardDescription>
                Full list of auction items. Item numbers should match the display cards.
              </CardDescription>
            </div>
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
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[650px]">
            <Table>
              <TableHeader className="bg-slate-50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="w-[15%]">Item #</TableHead>
                  <TableHead className="w-[35%]">Item Name</TableHead>
                  <TableHead className="w-[25%]">Type</TableHead>
                  <TableHead className="w-[25%]">Winning Bidder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4} className="h-12 animate-pulse" />
                    </TableRow>
                  ))
                ) : filteredItems.length > 0 ? (
                  filteredItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="w-[15%] font-mono font-bold text-primary whitespace-normal break-words">{item.id}</TableCell>
                      <TableCell className="w-[35%] font-medium whitespace-normal break-words">{item.name}</TableCell>
                      <TableCell className="w-[25%] text-xs uppercase text-muted-foreground font-semibold whitespace-normal break-words">{item.type || "—"}</TableCell>
                      <TableCell className="w-[25%] whitespace-normal break-words">
                        {winners[item.id] ? (
                          <span className="font-semibold text-emerald-600">{winners[item.id]}</span>
                        ) : (
                          <span className="text-muted-foreground text-sm italic">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-muted-foreground text-sm">
                      {searchTerm ? "No items match your search." : "No items loaded. Check your Spreadsheet ID in Settings."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}