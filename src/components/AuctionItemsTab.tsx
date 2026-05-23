import { useState, useEffect, useMemo } from "react";
import { useConfig } from "@/context/ConfigContext";
import { useAuction } from "@/context/AuctionContext";
import { fetchWithRetry, getSheetData, updateSheetData, getBaseUrl, appendSheetData, deleteAuctionItem } from "@/lib/google-api";
import { motion, AnimatePresence } from "motion/react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, ArrowUpDown, ArrowDown, ArrowUp, Search, Filter, Trash2, Package, Wand2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

import { Bidder, AuctionItem, Attendee, Guest } from "@/types";
import { EditableCell } from "@/components/ui/EditableCell";
import { useAuctionItems } from "@/hooks/useAuctionItems";
import { useBundling } from "@/hooks/useBundling";
import { BundlingDialog } from "@/components/BundlingDialog";

interface BundlingSelection {
  [rowIndex: number]: boolean;
}

export default function AuctionItemsTab() {
  const { config } = useConfig();
  const { isAuctionClosed } = useAuction();
  const spreadsheetId = config.auctionItemsSpreadsheetId;
  const { 
    items, 
    setItems, 
    categories, 
    valueCalculations, 
    loading, 
    refresh: fetchData 
  } = useAuctionItems(spreadsheetId);
  const [sortConfig, setSortConfig] = useState<{key: keyof AuctionItem | null, direction: 'asc' | 'desc'}>({ key: 'id', direction: 'asc' });
  
  const [selectedRows, setSelectedRows] = useState<BundlingSelection>({});
  
  const {
    isBundling, setIsBundling,
    bundleDetails, setBundleDetails,
    aiSuggestions,
    loadingSuggestions,
    loadingDescription,
    isExecutingBundle,
    restoreBundleId, setRestoreBundleId,
    isExecutingRestore,
    openBundlingModal,
    getAiSuggestions,
    getAiDescriptionSuggestion,
    executeBundle,
    handleRestoreBundle
  } = useBundling(items, selectedRows, spreadsheetId, valueCalculations, fetchData);
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkField, setBulkField] = useState<"category" | "itemType" | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [isExecutingBulk, setIsExecutingBulk] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedItemType, setSelectedItemType] = useState("all");
  const [itemToDelete, setItemToDelete] = useState<AuctionItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedItemsCount = Object.values(selectedRows).filter(Boolean).length;
  const [newItem, setNewItem] = useState<Partial<AuctionItem>>({
    category: "",
    name: "",
    description: "",
    value: "",
    openingBid: "",
    minRaise: "",
    donor: "",
    itemType: ""
  });
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

  useEffect(() => {
    // fetchData is called by useAuctionItems on mount/spreadsheetId change
  }, [spreadsheetId]);

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
        if (v < 150) calculatedRaise = 5;
        else if (v < 300) calculatedRaise = 10;
        else if (v < 450) calculatedRaise = 15;
        else if (v < 600) calculatedRaise = 20;
        else if (v < 750) calculatedRaise = 30;
        else if (v < 900) calculatedRaise = 40;
        else calculatedRaise = 50;
      }
      raise = `$${calculatedRaise.toFixed(2)}`;
    }
    return { opening, raise };
  };

  const toggleRow = (rowIndex: number) => {
    setSelectedRows(prev => ({
      ...prev,
      [rowIndex]: !prev[rowIndex]
    }));
  };


  const executeBulkUpdate = async () => {
    if (!bulkField || !bulkValue || !spreadsheetId) return;
    
    setIsExecutingBulk(true);
    const selectedIndices = Object.keys(selectedRows).filter(k => selectedRows[parseInt(k)]).map(k => parseInt(k));
    const previousItems = [...items];

    // Optimistic Update
    setItems(prev => prev.map(item => 
      selectedIndices.includes(item.rowIndex) ? { ...item, [bulkField]: bulkValue } : item
    ));

    if (bulkField === 'category') {
      try {
        const response = await fetchWithRetry(`${getBaseUrl()}/api/auction/bulk-update-items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spreadsheetId,
            rowIndices: selectedIndices,
            field: bulkField,
            value: bulkValue
          })
        });
        const resData = await response.json();
        if (resData.error) throw new Error(resData.error);
        toast.success("Bulk categories updated and re-sequenced successfully!");
        setSelectedRows({});
        setIsBulkEditing(false);
        setBulkField(null);
        setBulkValue("");
        fetchData();
      } catch (e: any) {
        console.error("Bulk category update failed:", e);
        setItems(previousItems);
        toast.error("Failed to bulk update categories: " + e.message);
      } finally {
        setIsExecutingBulk(false);
      }
      return;
    }

    const colLetter = bulkField === 'itemType' ? 'I' : 'J';
    const updatePromises = selectedIndices.map(idx => 
      updateSheetData(spreadsheetId, `Auction-Items!${colLetter}${idx}`, [[bulkValue]])
    );

    // Background sync
    Promise.all(updatePromises)
      .then(() => {
        toast.success(`Updated ${bulkField} for ${selectedIndices.length} items`);
        setSelectedRows({});
        setIsBulkEditing(false);
        setBulkField(null);
        setBulkValue("");
      })
      .catch((e: any) => {
        // Rollback
        setItems(previousItems);
        toast.error("Failed to sync updates—retrying... local state reverted.");
      })
      .finally(() => {
        setIsExecutingBulk(false);
      });
  };

  const handleUpdate = async (rowIndex: number, field: keyof AuctionItem, colLetter: string, value: string) => {
    if (!spreadsheetId) return;
    
    const targetItem = items.find(i => i.rowIndex === rowIndex);
    if (!targetItem) return;

    const previousItems = [...items];

    let finalValueToSave = value;
    if (field === 'value' && value) {
      const parsedNum = parseDollar(value);
      if (parsedNum > 0) {
        finalValueToSave = `$${parsedNum.toFixed(2)}`;
      }
    }

    // Optimistic update
    setItems((prev) => 
      prev.map((item) => 
        item.rowIndex === rowIndex ? { ...item, [field]: finalValueToSave } : item
      )
    );

    let updateOpening = false;
    let updateRaise = false;
    let opening = "";
    let raise = "";

    if (field === 'value') {
      const calculated = calculateAutoBids(finalValueToSave);
      opening = calculated.opening;
      raise = calculated.raise;

      const currentOpening = targetItem.openingBid;
      const currentRaise = targetItem.minRaise;

      const isOpeningEmpty = !currentOpening || 
                             currentOpening.trim() === '' || 
                             currentOpening.trim() === '$' || 
                             currentOpening.trim() === '$,' || 
                             currentOpening.trim() === '$, ';
                             
      const isRaiseEmpty = !currentRaise || 
                           currentRaise.trim() === '' || 
                           currentRaise.trim() === '$' || 
                           currentRaise.trim() === '$,' || 
                           currentRaise.trim() === '$, ';

      if (opening && isOpeningEmpty) {
        setItems(p => p.map(i => i.rowIndex === rowIndex ? { ...i, openingBid: opening } : i));
        updateOpening = true;
      }
      if (raise && isRaiseEmpty) {
        setItems(p => p.map(i => i.rowIndex === rowIndex ? { ...i, minRaise: raise } : i));
        updateRaise = true;
      }
    }

    if (field === 'category') {
      try {
        const response = await fetchWithRetry(`${getBaseUrl()}/api/auction/update-item`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spreadsheetId,
            rowIndex,
            field,
            value
          })
        });
        const resData = await response.json();
        if (resData.error) throw new Error(resData.error);
        toast.success("Category updated and re-sequenced successfully!");
        fetchData();
      } catch (e: any) {
        console.error("Failed to sync category update", e);
        setItems(previousItems);
        toast.error("Failed to update category: " + e.message);
      }
      return;
    }

    // Background sync
    const syncOperations = [updateSheetData(spreadsheetId, `Auction-Items!${colLetter}${rowIndex}`, [[finalValueToSave]])];
    if (updateOpening) {
      syncOperations.push(updateSheetData(spreadsheetId, `Auction-Items!F${rowIndex}`, [[opening]]));
    }
    if (updateRaise) {
      syncOperations.push(updateSheetData(spreadsheetId, `Auction-Items!G${rowIndex}`, [[raise]]));
    }

    Promise.all(syncOperations)
      .then(() => toast.success('Saved successfully'))
      .catch(e => {
        console.error(e);
        // Rollback
        setItems(previousItems);
        toast.error("Failed to sync updates—retrying... local state reverted.");
      });
  };

  const handleAddItem = async () => {
    if (!spreadsheetId) return;
    if (!newItem.name || !newItem.category) {
      toast.error("Name and Category are required");
      return;
    }

    setIsSubmittingItem(true);
    const previousItems = [...items];

    try {
      let finalOpeningBid = newItem.openingBid || "";
      let finalMinRaise = newItem.minRaise || "";

      if (newItem.value && (!finalOpeningBid || !finalMinRaise)) {
        const { opening, raise } = calculateAutoBids(newItem.value);
        if (!finalOpeningBid) finalOpeningBid = opening;
        if (!finalMinRaise) finalMinRaise = raise;
      }

      // Call server endpoint to handle add + transactional resequencing
      const response = await fetchWithRetry(`${getBaseUrl()}/api/auction/add-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId,
          category: newItem.category,
          name: newItem.name,
          description: newItem.description || "",
          value: newItem.value || "",
          openingBid: finalOpeningBid,
          minRaise: finalMinRaise,
          donor: newItem.donor || "",
          itemType: newItem.itemType || ""
        })
      });

      const resData = await response.json();
      if (resData.error) throw new Error(resData.error);

      const assignedId = resData.assigned_id;
      toast.success(`Item added and sequenced successfully with ID ${assignedId}`);
      await fetchData(); // Full resync to confirm and load all auction items with their proper IDs

      setNewItem({
        category: "",
        name: "",
        description: "",
        value: "",
        openingBid: "",
        minRaise: "",
        donor: "",
        itemType: "",
        status: "",
        bundleId: "",
        bundledDateTime: ""
      });
      setIsAddingItem(false);
    } catch (e: any) {
      console.error(e);
      setItems(previousItems);
      toast.error("Failed to add item: " + e.message);
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const requestSort = (key: keyof AuctionItem) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') { direction = 'desc'; }
    setSortConfig({ key, direction });
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete || !spreadsheetId) return;
    
    setIsDeleting(true);
    const previousItems = [...items];
    
    try {
      // Optimistic delete
      setItems(prev => prev.filter(i => i.rowIndex !== itemToDelete.rowIndex));
      
      await deleteAuctionItem(spreadsheetId, itemToDelete.rowIndex);
      toast.success("Item deleted successfully");
      setItemToDelete(null);
      // Resync to get canonical row indices
      await fetchData();
    } catch (e: any) {
      console.error(e);
      setItems(previousItems);
      toast.error("Failed to delete item: " + e.message);
    } finally {
      setIsDeleting(false);
    }
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

    // Filter items first
    sortableItems = sortableItems.filter(item => {
      if (item.status === "Inactive" || item.status === "Deleted") return false;

      const searchStr = searchTerm.toLowerCase();
      const matchesSearch = !searchTerm || 
        item.name.toLowerCase().includes(searchStr) ||
        item.description.toLowerCase().includes(searchStr) ||
        item.category.toLowerCase().includes(searchStr) ||
        item.donor.toLowerCase().includes(searchStr) ||
        item.itemType.toLowerCase().includes(searchStr);
      
      const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
      const matchesType = selectedItemType === "all" || item.itemType === selectedItemType;

      return matchesSearch && matchesCategory && matchesType;
    });

    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key!]?.toString() || "";
        let bVal = b[sortConfig.key!]?.toString() || "";
        
        if (sortConfig.key === 'id') {
          return sortConfig.direction === 'asc' 
            ? (parseInt(aVal) || 0) - (parseInt(bVal) || 0) 
            : (parseInt(bVal) || 0) - (parseInt(aVal) || 0);
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
  }, [items, sortConfig, searchTerm, selectedCategory, selectedItemType]);

  const toggleAll = () => {
    if (selectedItemsCount === sortedItems.length && sortedItems.length > 0) {
      setSelectedRows({});
    } else {
      const all: BundlingSelection = {};
      sortedItems.forEach(item => {
        all[item.rowIndex] = true;
      });
      setSelectedRows(all);
    }
  };

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
              Showing {sortedItems.length} of {items.length} items from the Auction-Items spreadsheet. Click the edit icon to make changes.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {!isAuctionClosed && (
              <Button onClick={() => setIsAddingItem(true)} className="flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add New Item
              </Button>
            )}
            {isAuctionClosed && (
              <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 py-1.5 px-3">
                Auction Closed (Read Only)
              </Badge>
            )}
          </div>
        </CardHeader>
        <div className="px-6 pb-6 flex flex-col md:flex-row gap-4 items-end border-b bg-slate-50/30">
          <div className="flex-1 w-full space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 ml-1">
              <Search className="w-3 h-3" /> Search Items
            </Label>
            <Input 
              placeholder="Search by name, description, donor..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-white h-10"
            />
          </div>
          <div className="w-full md:w-[240px] space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 ml-1">
              <Filter className="w-3 h-3" /> Category
            </Label>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="bg-white h-10">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.sort().map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full md:w-[180px] space-y-1.5">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 ml-1">
              <Filter className="w-3 h-3" /> Item Type
            </Label>
            <Select value={selectedItemType} onValueChange={setSelectedItemType}>
              <SelectTrigger className="bg-white h-10">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Physical Item">Physical Item</SelectItem>
                <SelectItem value="Certificate">Certificate</SelectItem>
                <SelectItem value="Both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="pb-0.5">
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-muted-foreground hover:text-foreground h-9 px-3 text-xs font-medium"
              onClick={() => {
                setSearchTerm("");
                setSelectedCategory("all");
                setSelectedItemType("all");
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          <div className="rounded-md border overflow-x-auto pb-4">
            <Table className="w-full table-fixed">
            <TableHeader>
              <TableRow className="bg-slate-50 text-xs">
                <TableHead style={{ width: '40px' }} className="px-2">
                   <Checkbox checked={selectedItemsCount === sortedItems.length && sortedItems.length > 0} onCheckedChange={toggleAll} />
                </TableHead>
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
                <TableHead style={{ width: '60px' }} className="text-center">
                  Actions
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
                <AnimatePresence mode="popLayout">
                  {sortedItems.map((item) => (
                    <motion.tr 
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      key={item.rowIndex} 
                      className={`group/row border-b transition-colors ${selectedRows[item.rowIndex] ? 'bg-primary/5' : ''}`}
                    >
                      <TableCell className="px-2 align-top pt-4">
                        <Checkbox checked={!!selectedRows[item.rowIndex]} onCheckedChange={() => toggleRow(item.rowIndex)} />
                      </TableCell>
                    <TableCell className="font-mono text-xs align-top">
                      <EditableCell 
                        value={item.id} 
                        onSave={(val) => handleUpdate(item.rowIndex, 'id', 'A', val)} 
                        disabled={isAuctionClosed}
                      />
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-3">
                        <div className="font-medium text-base text-foreground">
                          <EditableCell 
                            value={item.name} 
                            onSave={(val) => handleUpdate(item.rowIndex, 'name', 'C', val)} 
                            disabled={isAuctionClosed}
                          />
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <EditableCell 
                            type="textarea"
                            value={item.description} 
                            onSave={(val) => handleUpdate(item.rowIndex, 'description', 'D', val)} 
                            disabled={isAuctionClosed}
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
                        disabled={isAuctionClosed}
                      />
                    </TableCell>
                    <TableCell className="align-top text-sm space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-12 shrink-0">Value:</span> 
                        <EditableCell 
                          value={item.value} 
                          onSave={(val) => handleUpdate(item.rowIndex, 'value', 'E', val)} 
                          disabled={isAuctionClosed}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-12 shrink-0">Open:</span>
                        <EditableCell 
                          value={item.openingBid} 
                          onSave={(val) => handleUpdate(item.rowIndex, 'openingBid', 'F', val)} 
                          disabled={isAuctionClosed}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-12 shrink-0">Raise:</span>
                        <EditableCell 
                          value={item.minRaise} 
                          onSave={(val) => handleUpdate(item.rowIndex, 'minRaise', 'G', val)} 
                          disabled={isAuctionClosed}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      <EditableCell 
                        value={item.donor} 
                        onSave={(val) => handleUpdate(item.rowIndex, 'donor', 'H', val)} 
                        disabled={isAuctionClosed}
                      />
                    </TableCell>
                      <TableCell className="align-top text-sm">
                        <EditableCell 
                          type="select"
                          options={['Physical Item', 'Certificate', 'Both']}
                          value={item.itemType} 
                          onSave={(val) => handleUpdate(item.rowIndex, 'itemType', 'I', val)} 
                          disabled={isAuctionClosed}
                        />
                        {item.bundleId && item.status === "Active" && (
                          <div className="mt-4 flex flex-col gap-2">
                            <Badge variant="secondary" className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 w-fit">
                              <Package className="w-3 h-3 mr-1" />
                              Bundle
                            </Badge>
                            {!isAuctionClosed && (
                              <Button 
                                size="sm" 
                                variant="outline" 
                                className="h-7 text-[10px] gap-1 px-2 border-purple-200 text-purple-700 hover:bg-purple-200 hover:text-purple-800 transition-colors w-fit"
                                disabled={isExecutingRestore}
                                onClick={() => handleRestoreBundle(item.bundleId)}
                              >
                                {isExecutingRestore && restoreBundleId === item.bundleId ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3 h-3" />
                                )}
                                Restore Items
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    <TableCell className="align-top text-center px-2">
                      {!isAuctionClosed && (
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 opacity-0 group-hover/row:opacity-100 transition-opacity"
                          onClick={() => setItemToDelete(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    {/* Selection Action Bar */}
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
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Bulk Actions</span>
          </div>
          <div className="w-[1px] h-10 bg-border" />
          <div className="flex gap-2">
            <Button size="sm" onClick={openBundlingModal} className="rounded-lg px-4 bg-primary hover:bg-primary/90 flex items-center gap-2">
              <Package className="w-4 h-4" /> Bundle
            </Button>
            
            <Select onValueChange={(val: string) => { setBulkField("category"); setBulkValue(val); setIsBulkEditing(true); }}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <SelectValue placeholder="Set Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select onValueChange={(val: string) => { setBulkField("itemType"); setBulkValue(val); setIsBulkEditing(true); }}>
              <SelectTrigger className="h-9 w-[130px] text-xs">
                <SelectValue placeholder="Set Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Physical Item">Physical Item</SelectItem>
                <SelectItem value="Certificate">Certificate</SelectItem>
                <SelectItem value="Both">Both</SelectItem>
              </SelectContent>
            </Select>

            <Button size="sm" variant="ghost" onClick={() => setSelectedRows({})} className="rounded-lg hover:bg-red-50 hover:text-red-600">
              Clear
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Bulk Edit Confirm Dialog */}
    <Dialog open={isBulkEditing} onOpenChange={setIsBulkEditing}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Bulk Update</DialogTitle>
          <DialogDescription>
            You are about to set the {bulkField} of {selectedItemsCount} items to <strong>"{bulkValue}"</strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsBulkEditing(false)}>Cancel</Button>
          <Button onClick={executeBulkUpdate} disabled={isExecutingBulk}>
            {isExecutingBulk ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Apply to {selectedItemsCount} Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <BundlingDialog 
      isBundling={isBundling}
      setIsBundling={setIsBundling}
      bundleDetails={bundleDetails}
      setBundleDetails={setBundleDetails}
      categories={categories}
      getAiSuggestions={getAiSuggestions}
      aiSuggestions={aiSuggestions}
      loadingSuggestions={loadingSuggestions}
      getAiDescriptionSuggestion={getAiDescriptionSuggestion}
      loadingDescription={loadingDescription}
      executeBundle={executeBundle}
      isExecutingBundle={isExecutingBundle}
    />


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

    <Dialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600 font-bold">
            <Trash2 className="w-5 h-5" /> Confirm Deletion
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to permanently delete <strong>{itemToDelete?.name}</strong>? 
            This action will remove the record from the database and cannot be undone easily.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => setItemToDelete(null)}>Cancel</Button>
          <Button 
            variant="destructive" 
            onClick={handleDeleteItem}
            disabled={isDeleting}
            className="flex items-center gap-2"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Confirm Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
