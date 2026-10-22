import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
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
  /**
   * Set false to keep the filters together as one unit instead of letting
   * them wrap one by one - found via a user-reported bug on Bidders.tsx,
   * whose 4 filter selects wrapped messily once a 4th ("Sort by") was
   * added. The group stays on the search box's row when it fits; when it
   * doesn't, the whole group drops onto its own line under the search box
   * (not a horizontal scrollbar - that reserved ~15px under the filters,
   * so the dropdowns sat above the centre of the bar). It scrolls
   * sideways only when the group is wider than the bar itself (phones,
   * narrow tablets). Defaults to the original wrapping behavior so every
   * other caller is unaffected.
   */
  filtersWrap?: boolean;
  /** Right-aligned content - a count badge, a refresh button, an action button. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Shared search + filter bar for table-driven views. Consolidates the
 * near-identical search/filter layout that used to be hand-rolled in
 * Items.tsx, Checkout.tsx, Bidders.tsx, and (since it moved off its own
 * bespoke Card-child bar - see CHANGELOG.md's "Search & Filter Actions
 * inside the main content area" fix) AuctionItemsTab.tsx too, via
 * AuctionItemsFilterControls.tsx in the `filters` slot. Wrapped in the
 * app's real `Card` (not a hand-rolled bg/border box) so every consumer
 * gets the same white-card treatment as the rest of the app - added per
 * the Checkout redesign, applied here at the shared-component level so
 * every existing caller picks it up at once instead of drifting.
 */
export function FilterToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchClassName,
  searchInputClassName,
  filters,
  filtersWrap = true,
  trailing,
  className,
}: FilterToolbarProps) {
  return (
    <Card className={cn("flex flex-col md:flex-row gap-4 items-center justify-between p-4", className)}>
      <div className={cn("flex flex-col md:flex-row gap-4 w-full md:flex-1 items-center", !filtersWrap && "md:flex-wrap")}>
        <div className={cn("relative w-full md:max-w-sm", searchClassName)}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            className={cn("pl-9", searchInputClassName)}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        {filters && (
          <div className={cn("flex gap-2 w-full md:w-auto", filtersWrap ? "flex-wrap" : "flex-nowrap overflow-x-auto md:max-w-full")}>
            {filters}
          </div>
        )}
      </div>
      {trailing && <div className="flex gap-2 w-full md:w-auto items-center justify-center md:justify-end">{trailing}</div>}
    </Card>
  );
}
