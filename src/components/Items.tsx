import { useState } from "react";
import { useAuction } from "@/context/AuctionContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tag, Search } from "lucide-react";
import { toast } from "sonner";

export default function Items() {
  const { items, winners, loading } = useAuction();
  const [searchTerm, setSearchTerm] = useState("");

  const filteredItems = items.filter(item =>
    item.status === "Active" &&
    (item.id.toString().includes(searchTerm) ||
    item.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[650px]">
            <Table className="table-fixed w-full">
              <TableHeader className="bg-slate-50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="w-[15%] whitespace-normal break-words">Item #</TableHead>
                  <TableHead className="w-[35%] whitespace-normal break-words">Item Name</TableHead>
                  <TableHead className="w-[25%] whitespace-normal break-words">Type</TableHead>
                  <TableHead className="w-[25%] whitespace-normal break-words">Winning Bidder</TableHead>
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
                      <TableCell className="w-[25%] text-xs uppercase text-muted-foreground font-semibold whitespace-normal break-words">{item.category || "—"}</TableCell>
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