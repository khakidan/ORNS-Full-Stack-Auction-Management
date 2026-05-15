import { useState, useEffect } from "react";
import { getSheetData, appendSheetData, batchUpdateSheet, getBaseUrl } from "@/lib/google-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AuctionItem {
  rowIndex: number;
  id: string;
  category: string;
  bundled: string;
  name: string;
  description: string;
  value: string;
  openingBid: string;
  minRaise: string;
  donor: string;
  itemType: string;
}

export default function BundlingWorkflow() {
  const spreadsheetId = localStorage.getItem("auctionItemsSpreadsheetId");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesWithBase, setCategoriesWithBase] = useState<{name: string, base: number}[]>([]);
  const [valueCalculations, setValueCalculations] = useState<{minRange: number, minRaise: number}[]>([]);

  const [isBundling, setIsBundling] = useState(false);
  const [bundledItem, setBundledItem] = useState<Partial<AuctionItem>>({});
  const [suggestedNames, setSuggestedNames] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch items
  useEffect(() => {
    fetchData();
    fetchCategories();
    fetchValueCalculations();
  }, [spreadsheetId]);

  async function fetchValueCalculations() {
    if (!spreadsheetId) return;
    try {
      const data = await getSheetData(spreadsheetId, "Value Calculations!A:B");
      if (data.values && data.values.length > 1) {
        const tiers = data.values.slice(1).map((row: any[]) => ({
          minRange: parseFloat(row[0]?.toString().replace(/[^0-9.-]+/g, "") || "0"),
          minRaise: parseFloat(row[1]?.toString().replace(/[^0-9.-]+/g, "") || "0")
        })).filter((t: any) => !isNaN(t.minRange) && !isNaN(t.minRaise) && t.minRaise > 0);
        setValueCalculations(tiers);
      }
    } catch (error) {
      console.error("Failed to fetch value calculations:", error);
    }
  }

  async function fetchCategories() {
    if (!spreadsheetId) return;
    try {
      const data = await getSheetData(spreadsheetId, "Categories!A:B");
      if (data.values && data.values.length > 1) {
         const catsWithBase = data.values.slice(1).map((row: any[]) => ({
           name: row[0]?.toString() || "",
           base: parseInt(row[1]?.toString() || "0", 10) || 0
         })).filter((c: any) => c.name);
         setCategoriesWithBase(catsWithBase);
         setCategories(catsWithBase.map((c: any) => c.name));
      }
    } catch (error) {
      console.error("Failed to fetch categories:", error);
    }
  }

  async function fetchData() {
    if (!spreadsheetId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getSheetData(spreadsheetId, "Auction-Items!A:J");
      if (data.values && data.values.length > 1) {
        const rows = data.values.slice(1).map((row: any[], index: number) => {
          return {
            rowIndex: index + 2,
            id: row[0]?.toString() || "",
            category: row[1]?.toString() || "",
            bundled: row[2]?.toString() || "",
            name: row[3]?.toString() || "",
            description: row[4]?.toString() || "",
            value: row[5]?.toString() || "",
            openingBid: row[6]?.toString() || "",
            minRaise: row[7]?.toString() || "",
            donor: row[8]?.toString() || "",
            itemType: row[9]?.toString() || "",
          };
        }).filter((item: any) => item.id && item.name && item.bundled !== "yes");
        setItems(rows);
      }
    } catch (error) {
      console.error("Failed to fetch auction items:", error);
      toast.error("Failed to load auction items for bundling");
    } finally {
      setLoading(false);
    }
  }

  const parseDollar = (val: string) => {
    if (!val) return 0;
    const parsed = parseFloat(val.replace(/[^0-9.-]+/g, ""));
    return isNaN(parsed) ? 0 : parsed;
  };

  const calculateAutoBids = (valStr: string) => {
    const v = parseDollar(valStr);
    let opening = "";
    let raise = "";
    if (v > 0) {
      opening = (v * 0.45).toFixed(2);
      
      let calculatedRaise = 5;
      if (valueCalculations.length > 0) {
        const sorted = [...valueCalculations].sort((a,b) => a.minRange - b.minRange);
        for (const tier of sorted) {
          if (v >= tier.minRange) {
            calculatedRaise = tier.minRaise;
          }
        }
      } else {
        if (v >= 1000) calculatedRaise = 50;
        else if (v >= 500) calculatedRaise = 20;
        else if (v >= 300) calculatedRaise = 15;
        else if (v >= 150) calculatedRaise = 10;
        else calculatedRaise = 5;
      }
      raise = calculatedRaise.toFixed(2);
    }
    return { opening, raise };
  };

  const handleSelect = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedItemIds(prev => [...prev, id]);
    } else {
      setSelectedItemIds(prev => prev.filter(i => i !== id));
    }
  };

  const selectedItemsDetails = selectedItemIds.map(id => items.find(i => i.id === id)).filter(Boolean) as AuctionItem[];

  const startBundling = () => {
    if (selectedItemsDetails.length < 2) {
      toast.error("Select at least 2 items to bundle");
      return;
    }

    // Merge logic
    let totalValue = 0;
    let desc = "";
    let donorsArray: string[] = [];
    let isPhysical = false;
    let isCertificate = false;

    selectedItemsDetails.forEach(item => {
      totalValue += parseDollar(item.value);
      if (item.name || item.description) {
        desc += `• ${item.name}: ${item.description}\n`;
      }
      if (item.donor) {
        donorsArray.push(...item.donor.split("|").map(d => d.trim()));
      }
      if (item.itemType?.toLowerCase().includes("physical") || item.itemType?.toLowerCase().includes("both")) isPhysical = true;
      if (item.itemType?.toLowerCase().includes("certificate") || item.itemType?.toLowerCase().includes("both")) isCertificate = true;
    });

    const dedupedDonors = Array.from(new Set(donorsArray)).join(" | ");
    let finalType = "Both";
    if (isPhysical && !isCertificate) finalType = "Physical Item";
    if (!isPhysical && isCertificate) finalType = "Certificate";

    const commonCatMap = new Map<string, number>();
    selectedItemsDetails.forEach(item => {
      if (item.category) {
        commonCatMap.set(item.category, (commonCatMap.get(item.category) || 0) + 1);
      }
    });
    
    let suggestedCategory = "";
    if (commonCatMap.size > 0) {
      let max = 0;
      for (const [cat, count] of Array.from(commonCatMap.entries())) {
        if (count > max) { max = count; suggestedCategory = cat; }
      }
    }

    setBundledItem({
      name: "",
      category: suggestedCategory,
      bundled: "yes",
      description: desc.trim(),
      value: totalValue.toFixed(2),
      donor: dedupedDonors,
      itemType: finalType,
      openingBid: "",
      minRaise: "",
    });

    setSuggestedNames([]);
    setIsBundling(true);
  };

  const getAIOptions = async () => {
    setIsSuggesting(true);
    try {
      const descriptions = selectedItemsDetails.map(item => `${item.name}: ${item.description}`);
      const res = await fetch(`${getBaseUrl()}/api/ai/suggest-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptions })
      });
      const data = await res.json();
      if (!data.names) throw new Error("Failed to suggest names");
      setSuggestedNames(data.names);
    } catch(e) {
      console.error(e);
      toast.error("Failed to generate AI names");
    } finally {
      setIsSuggesting(false);
    }
  };

  const finishBundling = async () => {
    if (!spreadsheetId) return;
    if (!bundledItem.name || !bundledItem.category) {
      toast.error("Name and Category are required");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Generate new ID based on Category base array
      const catBase = categoriesWithBase.find(c => c.name === bundledItem.category)?.base || 0;
      
      // Look up existing IDs from all items
      const allItemData = await getSheetData(spreadsheetId, "Auction-Items!A:A");
      let itemIds: number[] = [];
      if (allItemData.values) {
        itemIds = allItemData.values.slice(1).map((r: any) => parseInt(r[0], 10)).filter((n: number) => !isNaN(n));
      }

      let nextVal = catBase > 0 ? catBase + 1 : 1;
      const validIds = catBase > 0 ? itemIds.filter(num => num >= catBase && num < catBase + 100) : itemIds;
      if (validIds.length > 0) {
        nextVal = Math.max(...validIds) + 1;
      }

      const newIdString = nextVal.toString();

      // 2. Auto Bid Fields
      let finalOpeningBid = bundledItem.openingBid || "";
      let finalMinRaise = bundledItem.minRaise || "";

      if (bundledItem.value && (!finalOpeningBid || !finalMinRaise)) {
        const { opening, raise } = calculateAutoBids(bundledItem.value);
        if (!finalOpeningBid) finalOpeningBid = opening;
        if (!finalMinRaise) finalMinRaise = raise;
      }

      const submitRow = [
        Number(newIdString),
        bundledItem.category || "",
        bundledItem.bundled || "",
        bundledItem.name || "",
        bundledItem.description || "",
        bundledItem.value ? Number(bundledItem.value.toString().replace(/[^0-9.-]+/g, "")) : "",
        finalOpeningBid ? Number(finalOpeningBid.toString().replace(/[^0-9.-]+/g, "")) : "",
        finalMinRaise ? Number(finalMinRaise.toString().replace(/[^0-9.-]+/g, "")) : "",
        bundledItem.donor || "",
        bundledItem.itemType || ""
      ];

      // 3. Append to bottom
      await appendSheetData(spreadsheetId, "Auction-Items!A:J", [submitRow]);

      // 4. Delete the original rows.
      // We will clear their contents instead of deleting dimension to avoid shifting row index problems that happen when
      // multiple rows are deleted sequentially.
      
      const updateData = selectedItemsDetails.map(item => ({
        range: `Auction-Items!A${item.rowIndex}:J${item.rowIndex}`,
        values: [["", "", "", "", "", "", "", "", "", ""]]
      }));

      // Instead of batchUpdate empty values or API calls sequentially, we use multiple API calls for simplicity
      for (const req of updateData) {
         // It's safer to delete or clear
         await fetch(`${getBaseUrl()}/api/sheets/${spreadsheetId}/${encodeURIComponent(req.range)}`, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ values: req.values }),
           credentials: "include"
         });
      }

      toast.success(`Bundled successfully as Item ${newIdString}`);
      setSelectedItemIds([]);
      setIsBundling(false);
      fetchData(); // Reload
    } catch(e) {
      console.error(e);
      toast.error("Error creating bundle");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Bundle Items</CardTitle>
            <CardDescription>
              Select multiple un-bundled items below to merge them into a single bundle.
            </CardDescription>
          </div>
          <Button disabled={selectedItemIds.length < 2} onClick={startBundling}>
            Bundle {selectedItemIds.length} Items <Plus className="ml-2 w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-md border overflow-x-auto pb-4 max-h-[600px] overflow-y-auto">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead style={{ width: '40px' }} className="text-center"></TableHead>
                  <TableHead style={{ width: '7%' }}>ID</TableHead>
                  <TableHead style={{ width: '30%' }}>Name & Description</TableHead>
                  <TableHead style={{ width: '15%' }}>Category</TableHead>
                  <TableHead style={{ width: '15%' }}>Value / Bids</TableHead>
                  <TableHead style={{ width: '15%' }}>Donor</TableHead>
                  <TableHead style={{ width: '15%' }}>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                     <TableCell colSpan={7} className="text-center py-8">
                       <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                     </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                     <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                       No un-bundled items found to show.
                     </TableCell>
                  </TableRow>
                ) : items.map(item => (
                  <TableRow key={item.id} className="hover:bg-slate-50">
                    <TableCell className="text-center">
                      <Checkbox 
                        checked={selectedItemIds.includes(item.id)}
                        onCheckedChange={(c) => handleSelect(item.id, c === true)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.id}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-1" title={item.description}>{item.description}</div>
                    </TableCell>
                    <TableCell className="text-xs">{item.category}</TableCell>
                    <TableCell className="text-xs">
                      <div className="font-medium text-emerald-700">{item.value}</div>
                      {item.openingBid && <div className="text-xs text-muted-foreground mt-1">Op: {item.openingBid}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{item.donor}</TableCell>
                    <TableCell className="text-xs">{item.itemType}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isBundling} onOpenChange={(c) => !isSubmitting && setIsBundling(c)}>
        <DialogContent className="sm:max-w-[700px] overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Configure Bundle</DialogTitle>
            <DialogDescription>
              We've automatically merged the text from your selected items. Set a clever name and select the correct category!
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right font-bold text-primary">Bundle Name *</Label>
              <div className="col-span-3 space-y-2">
                <div className="flex gap-2">
                  <Input 
                    value={bundledItem.name} 
                    onChange={e => setBundledItem({...bundledItem, name: e.target.value})} 
                    placeholder="E.g. Adventure Package" 
                  />
                  <Button variant="outline" size="icon" onClick={getAIOptions} disabled={isSuggesting} title="Suggest Name with AI">
                    {isSuggesting ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <Sparkles className="w-4 h-4 text-primary" />}
                  </Button>
                </div>
                {suggestedNames.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {suggestedNames.map((n, i) => (
                      <Badge key={i} variant="secondary" className="cursor-pointer hover:bg-primary hover:text-white" onClick={() => setBundledItem({...bundledItem, name: n})}>
                        {n}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Category *</Label>
              <div className="col-span-3">
                <Select value={bundledItem.category} onValueChange={(val) => setBundledItem({...bundledItem, category: val})}>
                  <SelectTrigger><SelectValue placeholder="Select Category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-4 items-start gap-4">
              <Label className="text-right mt-3">Description</Label>
              <div className="col-span-3">
                <Textarea 
                  value={bundledItem.description} 
                  onChange={e => setBundledItem({...bundledItem, description: e.target.value})} 
                  className="min-h-[120px]"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Total Value</Label>
              <div className="col-span-3"><Input value={bundledItem.value} onChange={e => setBundledItem({...bundledItem, value: e.target.value})} /></div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Donor</Label>
              <div className="col-span-3"><Input value={bundledItem.donor} onChange={e => setBundledItem({...bundledItem, donor: e.target.value})} /></div>
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Type</Label>
              <div className="col-span-3">
                <Select value={bundledItem.itemType} onValueChange={(val) => setBundledItem({...bundledItem, itemType: val})}>
                  <SelectTrigger><SelectValue placeholder="Select Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Physical Item">Physical Item</SelectItem>
                    <SelectItem value="Certificate">Certificate</SelectItem>
                    <SelectItem value="Both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsBundling(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={finishBundling} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
              Create Bundle!
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
