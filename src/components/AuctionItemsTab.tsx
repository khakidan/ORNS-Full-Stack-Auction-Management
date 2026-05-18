import { useState, useEffect, useMemo } from "react";
import { useConfig } from "@/context/ConfigContext";
import { fetchWithRetry, getSheetData, updateSheetData, getBaseUrl, appendSheetData, deleteAuctionItem } from "@/lib/google-api";
import { motion, AnimatePresence } from "motion/react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Edit2, Check, X, Plus, ArrowUpDown, ArrowDown, ArrowUp, Package, Wand2, Trash2, History, RotateCcw, Search, Filter } from "lucide-react";
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
  bundled: string;
  name: string;
  description: string;
  value: string;
  openingBid: string;
  minRaise: string;
  donor: string;
  itemType: string;
}

interface BundlingSelection {
  [rowIndex: number]: boolean;
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
  const { config } = useConfig();
  const spreadsheetId = config.auctionItemsSpreadsheetId;
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AuctionItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesWithBase, setCategoriesWithBase] = useState<{name: string, base: number}[]>([]);
  const [valueCalculations, setValueCalculations] = useState<{minRange: number, minRaise: number}[]>([]);
  const [sortConfig, setSortConfig] = useState<{key: keyof AuctionItem | null, direction: 'asc' | 'desc'}>({ key: null, direction: 'asc' });
  
  const [selectedRows, setSelectedRows] = useState<BundlingSelection>({});
  const [isBundling, setIsBundling] = useState(false);
  const [bundleDetails, setBundleDetails] = useState<Partial<AuctionItem>>({});
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingDescription, setLoadingDescription] = useState(false);
  const [isExecutingBundle, setIsExecutingBundle] = useState(false);
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkField, setBulkField] = useState<"category" | "itemType" | null>(null);
  const [bulkValue, setBulkValue] = useState("");
  const [isExecutingBulk, setIsExecutingBulk] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [backups, setBackups] = useState<{title: string, sheetId: number}[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
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
    itemType: "",
    bundled: ""
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
            bundled: row[2]?.toString() || "",
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

  const toggleRow = (rowIndex: number) => {
    setSelectedRows(prev => ({
      ...prev,
      [rowIndex]: !prev[rowIndex]
    }));
  };

  const toggleAll = () => {
    if (selectedItemsCount === sortedItems.length) {
      setSelectedRows({});
    } else {
      const all: BundlingSelection = {};
      sortedItems.forEach(item => {
        all[item.rowIndex] = true;
      });
      setSelectedRows(all);
    }
  };

  const openBundlingModal = () => {
    const selectedItems = items.filter(i => selectedRows[i.rowIndex]);
    if (selectedItems.length < 2) {
      toast.error("Select at least 2 items to bundle");
      return;
    }

    // Merge logic
    const mergedDescription = selectedItems.map(i => `- ${i.name}: ${i.description}`).join('\n\n');
    const totalValue = selectedItems.reduce((sum, item) => sum + parseDollar(item.value), 0);
    const mergedDonor = Array.from(new Set(selectedItems.map(i => i.donor).filter(Boolean))).join(', ');
    const commonCategory = selectedItems[0].category;
    
    // Auto Bid calculation for bundle
    const { opening, raise } = calculateAutoBids(totalValue.toString());

    setBundleDetails({
      category: commonCategory,
      name: "",
      description: mergedDescription,
      value: totalValue > 0 ? `$${totalValue.toFixed(2)}` : "",
      donor: mergedDonor,
      openingBid: opening,
      minRaise: raise,
      itemType: selectedItems[0].itemType,
      bundled: "yes"
    });
    setAiSuggestions([]);
    setIsBundling(true);
  };

  const getAiSuggestions = async () => {
    const selectedItems = items.filter(i => selectedRows[i.rowIndex]);
    setLoadingSuggestions(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bundle/suggest-names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedItems })
      });
      const data = await res.json();
      
      if (data.fallback) {
        toast.error("AI generation failed. Please enter a bundle name manually.");
        setAiSuggestions([
          "The Ultimate Collection",
          "Deluxe Surprise Package",
          "Premium Gala Bundle"
        ]);
        return;
      }
      
      if (data.error) throw new Error(data.error);
      setAiSuggestions(data.suggestions || []);
    } catch (e: any) {
      toast.error("AI naming failed: " + e.message);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const getAiDescriptionSuggestion = async () => {
    const selectedItems = items.filter(i => selectedRows[i.rowIndex]);
    setLoadingDescription(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bundle/suggest-description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedItems })
      });
      const data = await res.json();
      
      if (data.fallback) {
        toast.error("AI generation failed. Please write a description manually.");
        setBundleDetails(prev => ({ 
          ...prev, 
          description: "An exclusive item collection bundled together for this special event. Don't miss out!" 
        }));
        return;
      }
      
      if (data.error) throw new Error(data.error);
      setBundleDetails(prev => ({ ...prev, description: data.description }));
      toast.success("AI description generated!");
    } catch (e: any) {
      toast.error("AI description failed: " + e.message);
    } finally {
      setLoadingDescription(false);
    }
  };

  const fetchBackups = async () => {
    if (!spreadsheetId) return;
    setLoadingBackups(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/backups/list/${spreadsheetId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBackups(data);
    } catch (e: any) {
      toast.error("Failed to load backups: " + e.message);
    } finally {
      setLoadingBackups(false);
    }
  };

  const executeRestore = async (backupName: string) => {
    if (!spreadsheetId) return;
    if (!confirm(`Are you sure you want to restore "${backupName}"? This will replace the current Auction-Items tab.`)) return;

    setIsRestoring(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/backups/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId, backupSheetName: backupName })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success("Backup restored successfully!");
      setIsRestoreOpen(false);
      await fetchData();
    } catch (e: any) {
      toast.error("Restore failed: " + e.message);
    } finally {
      setIsRestoring(false);
    }
  };

  const executeBundle = async () => {
    if (!bundleDetails.name || !bundleDetails.category) {
      toast.error("Bundle Name and Category are required");
      return;
    }

    setIsExecutingBundle(true);
    const previousItems = [...items];
    const idempotencyKey = crypto.randomUUID?.() || Math.random().toString(36).substring(2);

    try {
      const selectedItems = items.filter(i => selectedRows[i.rowIndex]);
      const sourceRowIndices = selectedItems.map(i => i.rowIndex);
      
      // Calculate ID
      const catBase = categoriesWithBase.find(c => c.name === bundleDetails.category)?.base || 0;
      const itemsInCat = items.filter(i => {
        const idNum = parseInt(i.id, 10);
        return i.category === bundleDetails.category || (!isNaN(idNum) && catBase > 0 && idNum >= catBase && idNum < catBase + 100);
      });
      let nextId = catBase > 0 ? catBase + 1 : 1;
      const validIds = itemsInCat.map(i => parseInt(i.id, 10)).filter(num => !isNaN(num) && (catBase === 0 || (num >= catBase && num < catBase + 100)));
      if (validIds.length > 0) nextId = Math.max(...validIds) + 1;

      const optimisticId = nextId.toString();

      // Optimistic Update: Hide original items, add new bundle
      setItems(prev => {
        const remaining = prev.filter(item => !selectedRows[item.rowIndex]);
        const newBundle: AuctionItem = {
          rowIndex: 9999, // Temporary
          id: optimisticId,
          category: bundleDetails.category!,
          bundled: "yes",
          name: bundleDetails.name!,
          description: bundleDetails.description || "",
          value: bundleDetails.value || "",
          openingBid: bundleDetails.openingBid || "",
          minRaise: bundleDetails.minRaise || "",
          donor: bundleDetails.donor || "",
          itemType: bundleDetails.itemType || ""
        };
        return [...remaining, newBundle];
      });

      const bundleRow = [
        optimisticId,
        bundleDetails.category,
        "yes",
        bundleDetails.name,
        bundleDetails.description,
        bundleDetails.value,
        bundleDetails.openingBid,
        bundleDetails.minRaise,
        bundleDetails.donor,
        bundleDetails.itemType
      ];

      // Background sync
      fetchWithRetry(`${getBaseUrl()}/api/bundle/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId,
          bundleRow,
          sourceRowIndices,
          idempotencyKey
        })
      })
      .then(async (res) => {
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        toast.success("Items bundled successfully! Backup created.");
        fetchData(); // Resync to get real row indices
      })
      .catch((e: any) => {
        console.error(e);
        setItems(previousItems);
        toast.error("Failed to sync updates—retrying... local state reverted.");
      });

      setSelectedRows({});
      setIsBundling(false);
    } catch (e: any) {
      console.error(e);
      setItems(previousItems);
      toast.error("Failed to sync updates—retrying... local state reverted.");
    } finally {
      setIsExecutingBundle(false);
    }
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

    const colLetter = bulkField === 'category' ? 'B' : 'J';
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

    // Optimistic update
    setItems((prev) => 
      prev.map((item) => 
        item.rowIndex === rowIndex ? { ...item, [field]: value } : item
      )
    );

    let updateOpening = false;
    let updateRaise = false;
    let opening = "";
    let raise = "";

    if (field === 'value') {
      const calculated = calculateAutoBids(value);
      opening = calculated.opening;
      raise = calculated.raise;

      const currentOpening = targetItem.openingBid;
      const currentRaise = targetItem.minRaise;

      if (opening && (!currentOpening || currentOpening.trim() === '')) {
        setItems(p => p.map(i => i.rowIndex === rowIndex ? { ...i, openingBid: opening } : i));
        updateOpening = true;
      }
      if (raise && (!currentRaise || currentRaise.trim() === '')) {
        setItems(p => p.map(i => i.rowIndex === rowIndex ? { ...i, minRaise: raise } : i));
        updateRaise = true;
      }
    }

    // Background sync
    const syncOperations = [updateSheetData(spreadsheetId, `Auction-Items!${colLetter}${rowIndex}`, [[value]])];
    if (updateOpening) {
      syncOperations.push(updateSheetData(spreadsheetId, `Auction-Items!G${rowIndex}`, [[opening]]));
    }
    if (updateRaise) {
      syncOperations.push(updateSheetData(spreadsheetId, `Auction-Items!H${rowIndex}`, [[raise]]));
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
      // Determine new ID (simplified for optimistic)
      const catBase = categoriesWithBase.find(c => c.name === newItem.category)?.base || 0;
      const itemsInCat = items.filter(i => i.category === newItem.category);
      let nextVal = catBase > 0 ? catBase + 1 : 1;
      if (itemsInCat.length > 0) {
        const itemIds = itemsInCat.map(i => parseInt(i.id, 10)).filter(num => !isNaN(num));
        if (itemIds.length > 0) nextVal = Math.max(...itemIds) + 1;
      }
      
      const newIdString = nextVal.toString();
      let finalOpeningBid = newItem.openingBid || "";
      let finalMinRaise = newItem.minRaise || "";

      if (newItem.value && (!finalOpeningBid || !finalMinRaise)) {
        const { opening, raise } = calculateAutoBids(newItem.value);
        if (!finalOpeningBid) finalOpeningBid = opening;
        if (!finalMinRaise) finalMinRaise = raise;
      }

      const optimisticItem: AuctionItem = {
        rowIndex: items.length > 0 ? Math.max(...items.map(i => i.rowIndex)) + 1 : 2,
        id: newIdString,
        category: newItem.category!,
        bundled: newItem.bundled || "",
        name: newItem.name!,
        description: newItem.description || "",
        value: newItem.value || "",
        openingBid: finalOpeningBid,
        minRaise: finalMinRaise,
        donor: newItem.donor || "",
        itemType: newItem.itemType || ""
      };

      // Optimistic update
      setItems(prev => [...prev, optimisticItem]);

      const submitRow = [
        newIdString,
        newItem.category || "",
        newItem.bundled || "",
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
      await fetchData(); // Full resync to confirm row indices

      setNewItem({
        category: "",
        name: "",
        description: "",
        value: "",
        openingBid: "",
        minRaise: "",
        donor: "",
        itemType: "",
        bundled: ""
      });
      setIsAddingItem(false);
    } catch (e) {
      console.error(e);
      setItems(previousItems);
      toast.error("Failed to add item. Reverting UI state.");
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
            <Button variant="outline" size="sm" onClick={() => { setIsRestoreOpen(true); fetchBackups(); }} className="flex items-center gap-2">
              <History className="w-4 h-4" /> Restore Backup
            </Button>
            <Button onClick={() => setIsAddingItem(true)} className="flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add New Item
            </Button>
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
                          id={`bundled-${item.rowIndex}`} 
                          checked={item.bundled.toLowerCase() === 'yes' || item.bundled === '☑️' || item.bundled === 'true'} 
                          onCheckedChange={(checked) => {
                            handleUpdate(item.rowIndex, 'bundled', 'C', checked ? 'yes' : '');
                          }}
                        />
                        <label 
                          htmlFor={`bundled-${item.rowIndex}`} 
                          className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-muted-foreground cursor-pointer"
                        >
                          Bundled?
                        </label>
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-center px-2">
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50 opacity-0 group-hover/row:opacity-100 transition-opacity"
                        onClick={() => setItemToDelete(item)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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

    {/* Bundling Dialog */}
    <Dialog open={isBundling} onOpenChange={setIsBundling}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Package className="w-6 h-6 text-primary" /> Bundle Auction Items</DialogTitle>
          <DialogDescription>
            This will combine {selectedItemsCount} items into one new package. A backup of your spreadsheet will be created automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-bold flex items-center justify-between">
                <span>Bundle Name *</span>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-xs text-primary hover:text-primary animate-pulse flex items-center gap-1"
                  onClick={getAiSuggestions}
                  disabled={loadingSuggestions}
                >
                  {loadingSuggestions ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  Ask Gemini for Ideas
                </Button>
              </Label>
              
              {aiSuggestions.length > 0 && (
                <div className="bg-primary/5 p-3 rounded-lg border border-primary/20 space-y-2 mb-3">
                  <span className="text-[10px] font-bold text-primary uppercase">Suggested by Gemini:</span>
                  <div className="flex flex-wrap gap-2">
                    {aiSuggestions.map((name, i) => (
                      <Badge 
                        key={i} 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-primary hover:text-white transition-colors"
                        onClick={() => setBundleDetails({...bundleDetails, name})}
                      >
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Input 
                placeholder="e.g. The Ultimate Family Staycation Pack" 
                value={bundleDetails.name || ""} 
                onChange={(e) => setBundleDetails({...bundleDetails, name: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-bold">Category *</Label>
                <Select value={bundleDetails.category} onValueChange={(val) => setBundleDetails({...bundleDetails, category: val})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">Total Value (Calculated)</Label>
                <Input value={bundleDetails.value || ""} onChange={(e) => setBundleDetails({...bundleDetails, value: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-bold text-muted-foreground flex items-center justify-between">
                <span>Combined Description</span>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-xs text-primary hover:text-primary animate-pulse flex items-center gap-1"
                  onClick={getAiDescriptionSuggestion}
                  disabled={loadingDescription}
                >
                  {loadingDescription ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  Ask Gemini for Description
                </Button>
              </Label>
              <Textarea 
                className="min-h-[150px] text-xs font-mono"
                value={bundleDetails.description || ""} 
                onChange={(e) => setBundleDetails({...bundleDetails, description: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                <Label className="text-sm font-bold">Opening Bid</Label>
                <Input value={bundleDetails.openingBid || ""} onChange={(e) => setBundleDetails({...bundleDetails, openingBid: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-bold">Min Raise</Label>
                <Input value={bundleDetails.minRaise || ""} onChange={(e) => setBundleDetails({...bundleDetails, minRaise: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-bold">Donors (Combined)</Label>
              <Input value={bundleDetails.donor || ""} onChange={(e) => setBundleDetails({...bundleDetails, donor: e.target.value})} />
            </div>
          </div>
        </div>

        <DialogFooter className="bg-slate-50 -mx-6 -mb-6 p-6">
          <Button variant="outline" onClick={() => setIsBundling(false)}>Cancel</Button>
          <Button 
            onClick={executeBundle} 
            disabled={isExecutingBundle}
            className="bg-primary text-white hover:bg-primary/90 flex items-center gap-2"
          >
            {isExecutingBundle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
            Confirm Bundle & Merge Rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={isRestoreOpen} onOpenChange={setIsRestoreOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="w-5 h-5 text-primary" /> Restore Backup</DialogTitle>
          <DialogDescription>
            Choose a previous version of the Auction Items spreadsheet to restore. 
            This will archive your current version before replacing it.
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          {loadingBackups ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No backups found in this spreadsheet.
            </div>
          ) : (
            <div className="space-y-2">
              {backups.map((b) => (
                <div key={b.sheetId} className="flex items-center justify-between p-3 rounded-lg border hover:bg-slate-50 transition-colors">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{b.title}</span>
                  </div>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => executeRestore(b.title)}
                    disabled={isRestoring}
                  >
                    {isRestoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    <span className="ml-2">Restore</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>

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
                id="bundled-new" 
                checked={newItem.bundled === 'yes'}
                onCheckedChange={(checked) => setNewItem({...newItem, bundled: checked ? 'yes' : ''})}
              />
              <label 
                htmlFor="bundled-new" 
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Bundled?
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
