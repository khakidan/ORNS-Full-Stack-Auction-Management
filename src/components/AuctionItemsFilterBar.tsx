import { Search, Filter, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuctionItemSortConfig } from "@/hooks/useAuctionItemsFilterSort";

// SelectValue with no children renders the raw stored value, not the
// matching SelectItem's label (see component-standards.md's documented
// SelectValue failure mode) - "all" was showing verbatim instead of "All
// Categories"/"All Types". For every other value the label equals the
// value itself (a real category/item-type name), so only the "all"
// sentinel needs mapping.
const categoryLabel = (value: string) => (value === "all" ? "All Categories" : value);
const itemTypeLabel = (value: string) => (value === "all" ? "All Types" : value);

// Encodes an AuctionItemSortConfig as one string so it can back a single
// Select - the old clickable-column-header sort (AuctionItemsTable.tsx's
// SortIndicator) has nothing to attach to once the table becomes a
// flexible row list (AuctionItemsList.tsx). See
// docs/agents/refactor-opportunities.md's "UI / Layout Tweaks" item.
const SORT_OPTIONS: { value: string; label: string; config: AuctionItemSortConfig }[] = [
  { value: "id-asc", label: "Item # (Low to High)", config: { key: "id", direction: "asc" } },
  { value: "id-desc", label: "Item # (High to Low)", config: { key: "id", direction: "desc" } },
  { value: "name-asc", label: "Name (A to Z)", config: { key: "name", direction: "asc" } },
  { value: "name-desc", label: "Name (Z to A)", config: { key: "name", direction: "desc" } },
  { value: "category-asc", label: "Category (A to Z)", config: { key: "category", direction: "asc" } },
  { value: "category-desc", label: "Category (Z to A)", config: { key: "category", direction: "desc" } },
  { value: "value-asc", label: "Value (Low to High)", config: { key: "value", direction: "asc" } },
  { value: "value-desc", label: "Value (High to Low)", config: { key: "value", direction: "desc" } },
  { value: "donor-asc", label: "Donor (A to Z)", config: { key: "donor", direction: "asc" } },
  { value: "donor-desc", label: "Donor (Z to A)", config: { key: "donor", direction: "desc" } },
  { value: "itemType-asc", label: "Type (A to Z)", config: { key: "itemType", direction: "asc" } },
  { value: "itemType-desc", label: "Type (Z to A)", config: { key: "itemType", direction: "desc" } },
];

const SORT_LABELS: Record<string, string> = Object.fromEntries(SORT_OPTIONS.map((o) => [o.value, o.label]));

function sortConfigToValue(sortConfig: AuctionItemSortConfig): string {
  if (!sortConfig.key) return "id-asc";
  return `${sortConfig.key}-${sortConfig.direction}`;
}

interface AuctionItemsFilterBarProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  selectedCategory: string;
  onSelectedCategoryChange: (value: string) => void;
  selectedItemType: string;
  onSelectedItemTypeChange: (value: string) => void;
  categories: string[];
  onReset: () => void;
  sortConfig: AuctionItemSortConfig;
  onSortConfigChange: (config: AuctionItemSortConfig) => void;
}

export function AuctionItemsFilterBar({
  searchTerm,
  onSearchTermChange,
  selectedCategory,
  onSelectedCategoryChange,
  selectedItemType,
  onSelectedItemTypeChange,
  categories,
  onReset,
  sortConfig,
  onSortConfigChange,
}: AuctionItemsFilterBarProps) {
  return (
    <div className="px-6 pb-4 flex flex-col md:flex-row gap-4 items-end border-b bg-slate-50/30">
      <div className="flex-1 w-full space-y-1.5">
        <Label className="text-xxs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 ml-1">
          <Search className="w-3 h-3" /> Search Items
        </Label>
        <Input
          placeholder="Search by name, description, donor..."
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
          className="bg-white h-10"
        />
      </div>
      <div className="w-full md:w-60 space-y-1.5">
        <Label className="text-xxs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 ml-1">
          <Filter className="w-3 h-3" /> Category
        </Label>
        <Select value={selectedCategory} onValueChange={onSelectedCategoryChange}>
          <SelectTrigger className="bg-white h-10 w-full">
            <SelectValue placeholder="All Categories">{categoryLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-75">
            <SelectItem value="all">All Categories</SelectItem>
            {categories.sort().map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-full md:w-45 space-y-1.5">
        <Label className="text-xxs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 ml-1">
          <Filter className="w-3 h-3" /> Item Type
        </Label>
        <Select value={selectedItemType} onValueChange={onSelectedItemTypeChange}>
          <SelectTrigger className="bg-white h-10 w-full">
            <SelectValue placeholder="All Types">{itemTypeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="Physical Item">Physical Item</SelectItem>
            <SelectItem value="Certificate">Certificate</SelectItem>
            <SelectItem value="Both">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="w-full md:w-52 space-y-1.5">
        <Label className="text-xxs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 ml-1">
          <ArrowUpDown className="w-3 h-3" /> Sort By
        </Label>
        <Select
          value={sortConfigToValue(sortConfig)}
          onValueChange={(value) => {
            const option = SORT_OPTIONS.find((o) => o.value === value);
            if (option) onSortConfigChange(option.config);
          }}
        >
          <SelectTrigger className="bg-white h-10 w-full">
            <SelectValue placeholder="Sort by">{(value: string) => SORT_LABELS[value] ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="pb-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground h-9 px-3 text-xs font-medium"
          onClick={onReset}
        >
          Reset Filters
        </Button>
      </div>
    </div>
  );
}
