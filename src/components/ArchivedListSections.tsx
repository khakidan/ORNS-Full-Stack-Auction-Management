import { PackageX, Tag, UserCheck, UserX } from "lucide-react";
import { ArchivedAuction, AuctionItem, Bidder } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPageCard } from "@/components/ui/ListPageCard";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { FilterToolbar } from "@/components/FilterToolbar";
import { RowListShell } from "@/components/RowListShell";
import { ItemsList } from "@/components/ItemsList";
import { ArchivedBidderRow } from "@/components/ArchivedBidderRow";

export const STATUS_LABELS: Record<string, string> = {
  all: "All Bidders",
  "checked-in": "Checked In",
  "no-show": "No-Shows",
  proxy: "Proxy",
};

/** Who checked in, searchable and filtered by status. */
export function ArchivedCheckInSection({ year, bidders, loading, search, onSearchChange, statusFilter, onStatusFilterChange }: {
  year: number;
  bidders: Bidder[];
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <FilterToolbar
        searchValue={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search bidders..."
        filters={
          <Select value={statusFilter} onValueChange={(v) => v && onStatusFilterChange(v)}>
            <SelectTrigger className="h-10 w-37.5 shrink-0" aria-label="Status filter">
              <SelectValue>{(v: string) => STATUS_LABELS[v] ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <ListPageCard icon={<UserCheck className="w-5 h-5 text-primary" />} title="Bidder Check-In" description={`Who checked in at the ${year} auction.`} contentClassName="p-0">
        <RowListShell
          items={bidders}
          loading={loading}
          emptyIcon={<UserCheck className="w-7 h-7" />}
          emptyMessage="No bidders match your search or filter."
          renderRow={(b) => <ArchivedBidderRow key={b.id} bidder={b} />}
        />
      </ListPageCard>
    </div>
  );
}

/** Every item and who won it - or why there's no catalog for that year. */
export function ArchivedCatalogSection({ auction, allItemsCount, activeCount, items, winners, loading, search, onSearchChange }: {
  auction: ArchivedAuction;
  /** Rows on the archived Auction-Items sheet, any status. */
  allItemsCount: number;
  activeCount: number;
  items: AuctionItem[];
  winners: Record<string, string>;
  loading: boolean;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const { year } = auction;
  const missing = !auction.itemsSpreadsheetId
    ? `The "${year} Auction" folder has no "${year} Auction Items" spreadsheet, so the catalog can't be shown. That copy is made when the next auction year is set up.`
    : !loading && allItemsCount === 0
      ? `The "${year} Auction Items" spreadsheet has no rows on its Auction-Items sheet.`
      : null;

  if (missing) {
    return (
      <Card>
        <CardContent>
          <StatusStatePlaceholder icon={<Tag />} title="No auction catalog for this year" description={missing} />
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <FilterToolbar
        searchValue={search}
        onSearchChange={onSearchChange}
        searchPlaceholder="Search items by box number or name..."
        trailing={
          <div className="text-sm font-medium text-muted-foreground bg-white px-3 py-1.5 rounded border border-slate-200 shadow-sm">
            Total Items: <span className="text-orns-red font-bold">{activeCount}</span>
          </div>
        }
      />
      <ListPageCard icon={<Tag className="w-5 h-5 text-primary" />} title="Auction Catalog" description={`Every item in the ${year} auction and who won it.`} contentClassName="p-0">
        <ItemsList items={items} loading={loading} hasActiveSearch={search.length > 0} winners={winners} unwonLabel="No winner" />
      </ListPageCard>
    </div>
  );
}

/** Registered bidders who never checked in (proxy bidders aren't counted). */
export function ArchivedNoShowsSection({ year, noShows, loading }: { year: number; noShows: Bidder[]; loading: boolean }) {
  return (
    <ListPageCard
      icon={<UserX className="w-5 h-5 text-primary" />}
      title="No-Shows"
      description={`Bidders registered for the ${year} auction who never checked in (proxy bidders are not counted).`}
      contentClassName="p-0"
    >
      <RowListShell
        items={noShows}
        loading={loading}
        emptyIcon={<UserCheck className="w-7 h-7" />}
        emptyMessage="Everyone registered checked in."
        renderRow={(b) => <ArchivedBidderRow key={b.id} bidder={b} />}
      />
    </ListPageCard>
  );
}

/** Single-winner items that never got a winning bid. */
export function ArchivedNoBidsSection({ auction, items, loading }: { auction: ArchivedAuction; items: AuctionItem[]; loading: boolean }) {
  const { year } = auction;
  return (
    <ListPageCard
      icon={<PackageX className="w-5 h-5 text-primary" />}
      title="No Bid Items"
      description={`Items in the ${year} auction that never got a winning bid. Raffle tickets, open appeal and auction tickets are left out.`}
      contentClassName="p-0"
    >
      <ItemsList
        items={items}
        loading={loading}
        hasActiveSearch={false}
        winners={{}}
        unwonLabel="No winner"
        emptyMessage={auction.itemsSpreadsheetId ? "Every item received a winning bid." : `No "${year} Auction Items" spreadsheet was found, so there are no items to check.`}
      />
    </ListPageCard>
  );
}
