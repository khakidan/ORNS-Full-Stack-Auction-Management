import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FilterToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  /** Overrides the search field's wrapper div classes (e.g. width). */
  searchClassName?: string;
  /** Overrides the <Input> element's own classes (e.g. height, to match adjacent filter heights). */
  searchInputClassName?: string;
  /** Dropdown filters (e.g. <Select> elements), rendered next to the search input. */
  filters?: ReactNode;
  /** Right-aligned content - a count badge, a refresh button, an action button. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Shared search + filter bar for table-driven views. Consolidates the
 * near-identical search/filter layout that used to be hand-rolled in
 * Items.tsx, Checkout.tsx, and Bidders.tsx (see refactor-opportunities.md).
 * AuctionItemsTab has its own distinct labeled-field variant
 * (AuctionItemsFilterBar.tsx) and isn't migrated to this one.
 */
export function FilterToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchClassName,
  searchInputClassName,
  filters,
  trailing,
  className,
}: FilterToolbarProps) {
  return (
    <div className={cn("flex flex-col md:flex-row gap-4 items-center justify-between", className)}>
      <div className="flex flex-col md:flex-row gap-4 w-full md:flex-1 items-center">
        <div className={cn("relative w-full md:max-w-sm", searchClassName)}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            className={cn("pl-9", searchInputClassName)}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        {filters && <div className="flex flex-wrap gap-2 w-full md:w-auto">{filters}</div>}
      </div>
      {trailing && <div className="flex gap-2 w-full md:w-auto items-center justify-center md:justify-end">{trailing}</div>}
    </div>
  );
}
