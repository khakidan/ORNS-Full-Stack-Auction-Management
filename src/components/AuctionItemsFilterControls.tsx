import { ArrowUpDown, Filter } from "lucide-react";
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

interface AuctionItemsFilterControlsProps {
  selectedCategory: string;
  onSelectedCategoryChange: (value: string) => void;
  selectedItemType: string;
  onSelectedItemTypeChange: (value: string) => void;
  categories: string[];
  onReset: () => void;
  sortConfig: AuctionItemSortConfig;
  onSortConfigChange: (config: AuctionItemSortConfig) => void;
}

/**
 * Renders inside FilterToolbar.tsx's `filters` slot, matching
 * BiddersFilterControls.tsx's convention exactly - previously this page
 * had its own bespoke labeled-field bar (AuctionItemsFilterBar.tsx)
 * rendered as a Card child between CardHeader and CardContent, unlike
 * every other redesigned page's search/filter row (which sits above the
 * Card via FilterToolbar). That placement difference was flagged as its
 * own bug report ("Search & Filter Actions inside the main content
 * area") and was also the root cause of a string of whitespace bugs (see
 * CHANGELOG.md) - Card's own flex `gap-4` stacking with this bar's own
 * padding. Moving the search input into FilterToolbar and reducing this
 * to just the dropdown filters (Category/Item Type/Sort) plus a Reset
 * button removes the bespoke Card-child placement entirely, so there's
 * no longer a second `gap-4` boundary to fight.
 */
export function AuctionItemsFilterControls({
  selectedCategory,
  onSelectedCategoryChange,
  selectedItemType,
  onSelectedItemTypeChange,
  categories,
  onReset,
  sortConfig,
  onSortConfigChange,
}: AuctionItemsFilterControlsProps) {
  return (
    <>
      <Select value={selectedCategory} onValueChange={onSelectedCategoryChange}>
        <SelectTrigger className="h-10 w-45 shrink-0">
          <Filter className="w-3.5 h-3.5 mr-2 opacity-70" />
          <SelectValue placeholder="Category">{categoryLabel}</SelectValue>
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

      <Select value={selectedItemType} onValueChange={onSelectedItemTypeChange}>
        <SelectTrigger className="h-10 w-37.5 shrink-0">
          <Filter className="w-3.5 h-3.5 mr-2 opacity-70" />
          <SelectValue placeholder="Item Type">{itemTypeLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="Physical Item">Physical Item</SelectItem>
          <SelectItem value="Certificate">Certificate</SelectItem>
          <SelectItem value="Both">Both</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={sortConfigToValue(sortConfig)}
        onValueChange={(value) => {
          const option = SORT_OPTIONS.find((o) => o.value === value);
          if (option) onSortConfigChange(option.config);
        }}
      >
        <SelectTrigger className="h-10 w-60 shrink-0">
          <ArrowUpDown className="w-3.5 h-3.5 mr-2 opacity-70" />
          <SelectValue placeholder="Sort by">{(value: string) => SORT_LABELS[value] ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-10 px-3 text-xs font-medium shrink-0"
        onClick={onReset}
      >
        Reset Filters
      </Button>
    </>
  );
}
