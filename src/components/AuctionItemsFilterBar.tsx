import { Search, Filter } from "lucide-react";
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

// SelectValue with no children renders the raw stored value, not the
// matching SelectItem's label (see component-standards.md's documented
// SelectValue failure mode) - "all" was showing verbatim instead of "All
// Categories"/"All Types". For every other value the label equals the
// value itself (a real category/item-type name), so only the "all"
// sentinel needs mapping.
const categoryLabel = (value: string) => (value === "all" ? "All Categories" : value);
const itemTypeLabel = (value: string) => (value === "all" ? "All Types" : value);

interface AuctionItemsFilterBarProps {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  selectedCategory: string;
  onSelectedCategoryChange: (value: string) => void;
  selectedItemType: string;
  onSelectedItemTypeChange: (value: string) => void;
  categories: string[];
  onReset: () => void;
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
}: AuctionItemsFilterBarProps) {
  return (
    <div className="px-6 pb-6 flex flex-col md:flex-row gap-4 items-end border-b bg-slate-50/30">
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
