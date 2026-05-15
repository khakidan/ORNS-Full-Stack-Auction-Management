import { useState, useEffect, useMemo } from "react";
import { getSheetData, updateSheetData, getBaseUrl, appendSheetData } from "@/lib/google-api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Edit2, Check, X, Plus, ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface AuctionItem {
  rowIndex: number;
  id: string;
  category: string;
  packaged: string;
  name: string;
  description: string;
  value: string;
  openingBid: string;
  minRaise: string;
  donor: string;
  itemType: string;
}

function EditableCell({ 
  value, 
  onSave, 
  type = "text",
  options = []
}: { 
  value: string; 
  onSave: (val: string) => void; 
  type?: "text" | "textarea" | "select";
  options?: string[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  useEffect(() => {
    setTempValue(value);
  }, [value]);

  const handleSave = () => {
    onSave(tempValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempValue(value);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 min-w-[9rem] w-full">
        {type === "select" ? (
          <Select 
            value={tempValue} 
            onValueChange={(val) => setTempValue(val)}
            defaultOpen
          >
            <SelectTrigger className="h-8 text-sm w-full">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : type === "textarea" ? (
          <Textarea 
            value={tempValue} 
            onChange={(e) => setTempValue(e.target.value)}
            className="text-sm min-h-[80px] w-full"
            autoFocus
          />
        ) : (
          <Input 
            value={tempValue} 
            onChange={(e) => setTempValue(e.target.value)} 
            className="h-8 text-sm w-full"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
        )}
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs text-green-700 bg-green-100 hover:bg-green-200" onClick={handleSave}>
            <Check className="h-3 w-3 mr-1" /> Save
          </Button>
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs text-red-700 bg-red-100 hover:bg-red-200" onClick={handleCancel}>
            <X className="h-3 w-3 mr-1" /> Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex items-start gap-2">
      <span className="whitespace-pre-wrap break-words overflow-hidden text-ellipsis line-clamp-6">
        {value || <span className="text-muted-foreground italic">Empty</span>}
      </span>
      <Button 
        size="icon" 
        variant="ghost" 
        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" 
        onClick={() => setIsEditing(true)}
      >
        <Edit2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

export default function AuctionItemsTab() {
  const spreadsheetId = localStorage.getItem("auctionItemsSpreadsheetId");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesWithBase, setCategoriesWithBase] = useState<{name: string, base: number}[]>([]);
  const [valueCalculations, setValueCalculations] = useState<{minRange: number, minRaise: number}[]>([]);
  const [sortConfig, setSortConfig] = useState<{key: keyof AuctionItem | null, direction: 'asc' | 'desc'}>({ key: null, direction: 'asc' });
  
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItem, setNewItem] = useState<Partial<AuctionItem>>({
    category: "",
    name: "",
    description: "",
    value: "",
    openingBid: "",
    minRaise: "",
    donor: "",
    itemType: "",
    packaged: ""
  });
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

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
        // Skip header, filter out empty
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
    try {
      const data = await getSheetData(spreadsheetId, "Auction-Items!A:J");
      if (data.values && data.values.length > 1) {
        const rows = data.values.slice(1).map((row: any[], index: number) => {
          return {
            rowIndex: index + 2, // 1 for 1-based index, +1 for header row
            id: row[0]?.toString() || "",
            category: row[1]?.toString() || "",
            packaged: row[2]?.toString() || "",
            name: row[3]?.toString() || "",
            description: row[4]?.toString() || "",
            value: row[5]?.toString() || "",
            openingBid: row[6]?.toString() || "",
            minRaise: row[7]?.toString() || "",
            donor: row[8]?.toString() || "",
            itemType: row[9]?.toString() || "",
          };
        }).filter((item: any) => item.id && item.name);
        setItems(rows);
      }
    } catch (error) {
      console.error("Failed to fetch auction items:", error);
      toast.error("Failed to load auction items");
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
      opening = `$${(v * 0.45).toFixed(2)}`;
      
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
      raise = `$${calculatedRaise.toFixed(2)}`;
    }
    return { opening, raise };
  };

  const handleUpdate = async (rowIndex: number, field: keyof AuctionItem, colLetter: string, value: string) => {
    if (!spreadsheetId) return;
    
    const targetItem = items.find(i => i.rowIndex === rowIndex);
    if (!targetItem) return;

    // Optimistic update
    setItems((prev) => 
      prev.map((item) => 
        item.rowIndex === rowIndex ? { ...item, [field]: value } : item
      )
    );

    try {
      const updatePromise = updateSheetData(spreadsheetId, `Auction-Items!${colLetter}${rowIndex}`, [[value]]);
      toast.promise(updatePromise, {
        loading: 'Saving...',
        success: 'Saved successfully',
        error: 'Failed to save changes'
      });
      await updatePromise;

      if (field === 'value') {
        const { opening, raise } = calculateAutoBids(value);
        let updateOpening = false;
        let updateRaise = false;

        if (opening && (!targetItem.openingBid || targetItem.openingBid.trim() === '')) {
          setItems(p => p.map(i => i.rowIndex === rowIndex ? { ...i, openingBid: opening } : i));
          updateOpening = true;
        }
        if (raise && (!targetItem.minRaise || targetItem.minRaise.trim() === '')) {
          setItems(p => p.map(i => i.rowIndex === rowIndex ? { ...i, minRaise: raise } : i));
          updateRaise = true;
        }
        
        if (updateOpening) {
           await updateSheetData(spreadsheetId, `Auction-Items!G${rowIndex}`, [[opening]]);
        }
        if (updateRaise) {
           await updateSheetData(spreadsheetId, `Auction-Items!H${rowIndex}`, [[raise]]);
        }
      }
    } catch (e) {
      console.error(e);
      // Fallback: re-fetch on error
      fetchData();
    }
  };

  const handleAddItem = async () => {
    if (!spreadsheetId) return;
    if (!newItem.name || !newItem.category) {
      toast.error("Name and Category are required");
      return;
    }

    setIsSubmittingItem(true);
    try {
      // Determine new ID
      const catBase = categoriesWithBase.find(c => c.name === newItem.category)?.base || 0;
      
      const itemsInCat = items.filter(i => {
        const idNum = parseInt(i.id, 10);
        if (i.category === newItem.category) return true;
        if (!isNaN(idNum) && catBase > 0 && idNum >= catBase && idNum < catBase + 100) return true;
        return false;
      });

      let nextVal = catBase > 0 ? catBase + 1 : 1;
      if (itemsInCat.length > 0) {
        const itemIds = itemsInCat.map(i => parseInt(i.id, 10)).filter(num => !isNaN(num));
        // Only consider max from same category matching base if there's a base
        const validIds = catBase > 0 ? itemIds.filter(num => num >= catBase && num < catBase + 100) : itemIds;
        if (validIds.length > 0) {
          nextVal = Math.max(...validIds) + 1;
        } else if (itemIds.length > 0) {
          nextVal = Math.max(...itemIds) + 1;
        }
      }
      
      const newIdString = nextVal.toString();

      let finalOpeningBid = newItem.openingBid || "";
      let finalMinRaise = newItem.minRaise || "";

      if (newItem.value && (!finalOpeningBid || !finalMinRaise)) {
        const { opening, raise } = calculateAutoBids(newItem.value);
        if (!finalOpeningBid) finalOpeningBid = opening;
        if (!finalMinRaise) finalMinRaise = raise;
      }

      const submitRow = [
        newIdString,
        newItem.category || "",
        newItem.packaged || "",
        newItem.name || "",
        newItem.description || "",
        newItem.value || "",
        finalOpeningBid,
        finalMinRaise,
        newItem.donor || "",
        newItem.itemType || ""
      ];

      await appendSheetData(spreadsheetId, "Auction-Items!A:J", [submitRow]);

      toast.success(`Item added successfully with ID ${newIdString}`);
      
      await fetchData();

      setNewItem({
        category: "",
        name: "",
        description: "",
        value: "",
        openingBid: "",
        minRaise: "",
        donor: "",
        itemType: "",
        packaged: ""
      });
      setIsAddingItem(false);
    } catch (e) {
      console.error(e);
      toast.error("Failed to add new item");
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const requestSort = (key: keyof AuctionItem) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') { direction = 'desc'; }
    setSortConfig({ key, direction });
  };

  const SortIndicator = ({ columnKey }: { columnKey: keyof AuctionItem }) => {
    if (sortConfig.key !== columnKey) {
      return <ArrowUpDown className="ml-2 w-3 h-3 opacity-30 inline" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ArrowUp className="ml-2 w-3 h-3 inline text-primary" />
    ) : (
      <ArrowDown className="ml-2 w-3 h-3 inline text-primary" />
    );
  };

  const sortedItems = useMemo(() => {
    let sortableItems = [...items];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key!]?.toString() || "";
        let bVal = b[sortConfig.key!]?.toString() || "";
        
        if (sortConfig.key === 'id') {
          return sortConfig.direction === 'asc' 
            ? parseInt(aVal) - parseInt(bVal) 
            : parseInt(bVal) - parseInt(aVal);
        }
        
        if (sortConfig.key === 'value' || sortConfig.key === 'openingBid' || sortConfig.key === 'minRaise') {
          const aNum = parseDollar(aVal);
          const bNum = parseDollar(bVal);
          return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
        }

        if (aVal.toString().toLowerCase() < bVal.toString().toLowerCase()) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal.toString().toLowerCase() > bVal.toString().toLowerCase()) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig]);

  if (!spreadsheetId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not Configured</CardTitle>
          <CardDescription>Please set the Auction Items Spreadsheet ID in Config Settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Auction Items Database</CardTitle>
            <CardDescription>
              Showing {items.length} items from the Auction-Items spreadsheet. Click the edit icon to make changes.
            </CardDescription>
          </div>
          <Button onClick={() => setIsAddingItem(true)} className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add New Item
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="rounded-md border overflow-x-auto pb-4">
            <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead style={{ width: '7%' }} className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => requestSort('id')}>
                  ID <SortIndicator columnKey="id" />
                </TableHead>
                <TableHead style={{ width: '30%' }} className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => requestSort('name')}>
                  Name & Description <SortIndicator columnKey="name" />
                </TableHead>
                <TableHead style={{ width: '15%' }} className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => requestSort('category')}>
                  Category <SortIndicator columnKey="category" />
                </TableHead>
                <TableHead style={{ width: '18%' }} className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => requestSort('value')}>
                  Value / Bids <SortIndicator columnKey="value" />
                </TableHead>
                <TableHead style={{ width: '15%' }} className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => requestSort('donor')}>
                  Donor <SortIndicator columnKey="donor" />
                </TableHead>
                <TableHead style={{ width: '15%' }} className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => requestSort('itemType')}>
                  Type <SortIndicator columnKey="itemType" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No items found.
                  </TableCell>
                </TableRow>
              ) : (
                sortedItems.map((item) => (
                  <TableRow key={item.rowIndex} className="group/row">
                    <TableCell className="font-mono text-xs align-top">
                      <EditableCell 
                        value={item.id} 
                        onSave={(val) => handleUpdate(item.rowIndex, 'id', 'A', val)} 
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-3">
                        <div className="font-medium text-base text-foreground">
                          <EditableCell 
                            value={item.name} 
                            onSave={(val) => handleUpdate(item.rowIndex, 'name', 'D', val)} 
                          />
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <EditableCell 
                            type="textarea"
                            value={item.description} 
                            onSave={(val) => handleUpdate(item.rowIndex, 'description', 'E', val)} 
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <EditableCell 
                        type="select"
                        options={categories}
                        value={item.category} 
                        onSave={(val) => handleUpdate(item.rowIndex, 'category', 'B', val)} 
                      />
                    </TableCell>
                    <TableCell className="align-top text-sm space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-12 shrink-0">Value:</span> 
                        <EditableCell 
                          value={item.value} 
                          onSave={(val) => handleUpdate(item.rowIndex, 'value', 'F', val)} 
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-12 shrink-0">Open:</span>
                        <EditableCell 
                          value={item.openingBid} 
                          onSave={(val) => handleUpdate(item.rowIndex, 'openingBid', 'G', val)} 
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-12 shrink-0">Raise:</span>
                        <EditableCell 
                          value={item.minRaise} 
                          onSave={(val) => handleUpdate(item.rowIndex, 'minRaise', 'H', val)} 
                        />
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <EditableCell 
                        value={item.donor} 
                        onSave={(val) => handleUpdate(item.rowIndex, 'donor', 'I', val)} 
                      />
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <EditableCell 
                        type="select"
                        options={['Physical Item', 'Certificate', 'Both']}
                        value={item.itemType} 
                        onSave={(val) => handleUpdate(item.rowIndex, 'itemType', 'J', val)} 
                      />
                      <div className="flex items-center space-x-2 mt-4 ml-1">
                        <Checkbox 
                          id={`packaged-${item.rowIndex}`} 
                          checked={item.packaged.toLowerCase() === 'yes' || item.packaged === '☑️' || item.packaged === 'true'} 
                          onCheckedChange={(checked) => {
                            handleUpdate(item.rowIndex, 'packaged', 'C', checked ? 'yes' : '');
                          }}
                        />
                        <label 
                          htmlFor={`packaged-${item.rowIndex}`} 
                          className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-muted-foreground cursor-pointer"
                        >
                          Packaged?
                        </label>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog open={isAddingItem} onOpenChange={setIsAddingItem}>
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
                onValueChange={(val) => setNewItem({...newItem, category: val})}
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
                onChange={(e) => setNewItem({...newItem, name: e.target.value})}
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
                onChange={(e) => setNewItem({...newItem, description: e.target.value})}
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
                onChange={(e) => setNewItem({...newItem, value: e.target.value})}
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
                onChange={(e) => setNewItem({...newItem, donor: e.target.value})}
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
                onValueChange={(val) => setNewItem({...newItem, itemType: val})}
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
            <div className="col-start-2 col-span-3 flex items-center space-x-2">
              <Checkbox 
                id="packaged-new" 
                checked={newItem.packaged === 'yes'}
                onCheckedChange={(checked) => setNewItem({...newItem, packaged: checked ? 'yes' : ''})}
              />
              <label 
                htmlFor="packaged-new" 
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Packaged?
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsAddingItem(false)}>Cancel</Button>
          <Button onClick={handleAddItem} disabled={isSubmittingItem}>
            {isSubmittingItem ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
