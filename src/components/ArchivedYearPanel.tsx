import { useState } from "react";
import { BarChart3, ExternalLink, FolderOpen, Tag, UserCheck, UserX, Users, TrendingUp, UserMinus, PackageX } from "lucide-react";
import { useConfig } from "@/context/ConfigContext";
import { useArchivedAuctionData } from "@/hooks/useArchivedAuctionData";
import { ArchivedAuction } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListPageCard } from "@/components/ui/ListPageCard";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { FilterToolbar } from "@/components/FilterToolbar";
import { RowListShell } from "@/components/RowListShell";
import { StatTile } from "@/components/StatTile";
import { AttendanceChart } from "@/components/AttendanceChart";
import { ItemsList } from "@/components/ItemsList";
import { ArchivedBidderRow } from "@/components/ArchivedBidderRow";
import { VerticalNav } from "@/components/VerticalNav";

type Section = "overview" | "check_in" | "catalog" | "no_shows" | "no_bids";

const STATUS_LABELS: Record<string, string> = {
  all: "All Bidders",
  "checked-in": "Checked In",
  "no-show": "No-Shows",
  proxy: "Proxy",
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

function NotEnoughInfo({ year, detail }: { year: number; detail: string }) {
  return (
    <Card>
      <CardContent>
        <StatusStatePlaceholder
          icon={<FolderOpen />}
          title={`Not enough information for the ${year} auction`}
          description={detail}
        />
      </CardContent>
    </Card>
  );
}

/** One past auction: a left rail of sections (Overview, Bidder Check-In, Auction Catalog, No-Shows) beside the selected section. */
export default function ArchivedYearPanel({ auction }: { auction: ArchivedAuction }) {
  const { config } = useConfig();
  const { year } = auction;
  const data = useArchivedAuctionData(auction, config.bidderNumbersSheet || "Bidder-Numbers", config.bidManagementSheet || "Bid-Management");
  const [section, setSection] = useState<Section>("overview");
  const [bidderSearch, setBidderSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [itemSearch, setItemSearch] = useState("");

  if (!auction.folderId) {
    return <NotEnoughInfo year={year} detail={`There is no "${year} Auction" folder in the shared auction Drive (checked the main folder and the archive folder).`} />;
  }
  if (!auction.bidManagementSpreadsheetId) {
    return <NotEnoughInfo year={year} detail={`The "${year} Auction" folder has no "${year} Bid Management" spreadsheet. That copy is made when the next auction year is set up.`} />;
  }
  if (data.error) {
    return <NotEnoughInfo year={year} detail={`The archived spreadsheets couldn't be read: ${data.error}`} />;
  }
  if (!data.loading && !data.hasData) {
    return <NotEnoughInfo year={year} detail={`The "${year} Bid Management" spreadsheet has no bidder records.`} />;
  }

  const { attendance, loading } = data;
  const activeItems = data.items
    .filter((i) => i.status === "Active")
    .sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));

  const term = bidderSearch.toLowerCase();
  const filteredBidders = data.bidders
    .filter((b) => {
      if (statusFilter === "checked-in" && !b.checkedIn) return false;
      if (statusFilter === "no-show" && (b.checkedIn || b.isProxy)) return false;
      if (statusFilter === "proxy" && !b.isProxy) return false;
      return !term || b.id.includes(term) || `${b.firstName} ${b.lastName}`.toLowerCase().includes(term) || b.email.toLowerCase().includes(term);
    })
    .sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));

  // Multi-winner items (raffle tickets, open appeal, auction tickets) are
  // sold many times over, so "no winner" doesn't mean they went unsold.
  const noBidItems = activeItems.filter((i) => !i.allowMultipleWinners && !data.winners[i.id]);

  const filteredItems = activeItems.filter(
    (i) => i.id.includes(itemSearch) || i.name.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const attendanceStats = [
    { name: "Checked In", value: attendance.checkedIn, fill: "var(--chart-1)" },
    { name: "No-Show", value: attendance.noShows.length, fill: "var(--chart-3)" },
    { name: "Proxy", value: attendance.proxies, fill: "var(--chart-2)" },
  ];

  const overview = (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatTile label="Registered Bidders" icon={<Users className="w-4 h-4 text-muted-foreground" />} value={attendance.registered} />
        <StatTile
          label="Checked In"
          icon={<UserCheck className="w-4 h-4 text-muted-foreground" />}
          value={attendance.checkedIn}
          subtext={<p className="text-xs text-muted-foreground mt-1">{attendance.proxies} proxy bidder{attendance.proxies === 1 ? "" : "s"}</p>}
        />
        <StatTile
          label="No-Shows"
          icon={<UserMinus className="w-4 h-4 text-muted-foreground" />}
          value={attendance.noShows.length}
          valueClassName="text-amber-600"
          subtext={<p className="text-xs text-muted-foreground mt-1">{attendance.noShowPercent}% of bidders expected in person</p>}
        />
        <StatTile
          label="No Bid Items"
          icon={<PackageX className="w-4 h-4 text-muted-foreground" />}
          value={auction.itemsSpreadsheetId ? noBidItems.length : "N/A"}
          valueClassName={auction.itemsSpreadsheetId ? "text-amber-600" : undefined}
          subtext={
            <p className="text-xs text-muted-foreground mt-1">
              {auction.itemsSpreadsheetId ? `of ${activeItems.filter((i) => !i.allowMultipleWinners).length} auction items` : "No Auction Items spreadsheet"}
            </p>
          }
        />
        <StatTile label="Total Raised" icon={<TrendingUp className="w-4 h-4 text-muted-foreground" />} value={formatCurrency(data.totalRaised)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <AttendanceChart bidderStats={attendanceStats} />
        <Card>
          <CardHeader>
            <CardTitle>Archive Files</CardTitle>
            <CardDescription>Where this year's information lives in the shared auction Drive.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {auction.folderLink && (
              <Button variant="outline" className="justify-start gap-2" onClick={() => window.open(auction.folderLink!, "_blank", "noopener,noreferrer")}>
                <FolderOpen className="w-4 h-4" /> Open the {year} Auction folder
              </Button>
            )}
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${auction.bidManagementSpreadsheetId}`, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="w-4 h-4" /> Open {year} Bid Management
            </Button>
            {auction.itemsSpreadsheetId && (
              <Button
                variant="outline"
                className="justify-start gap-2"
                onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${auction.itemsSpreadsheetId}`, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="w-4 h-4" /> Open {year} Auction Items
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const checkIn = (
    <div className="space-y-6">
      <FilterToolbar
        searchValue={bidderSearch}
        onSearchChange={setBidderSearch}
        searchPlaceholder="Search bidders..."
        filters={
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
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
          items={filteredBidders}
          loading={loading}
          emptyIcon={<UserCheck className="w-7 h-7" />}
          emptyMessage="No bidders match your search or filter."
          renderRow={(b) => <ArchivedBidderRow key={b.id} bidder={b} />}
        />
      </ListPageCard>
    </div>
  );

  const catalogMissing = !auction.itemsSpreadsheetId
    ? `The "${year} Auction" folder has no "${year} Auction Items" spreadsheet, so the catalog can't be shown. That copy is made when the next auction year is set up.`
    : !loading && data.items.length === 0
      ? `The "${year} Auction Items" spreadsheet has no rows on its Auction-Items sheet.`
      : null;

  const catalog = catalogMissing ? (
    <Card>
      <CardContent>
        <StatusStatePlaceholder icon={<Tag />} title="No auction catalog for this year" description={catalogMissing} />
      </CardContent>
    </Card>
  ) : (
    <div className="space-y-6">
      <FilterToolbar
        searchValue={itemSearch}
        onSearchChange={setItemSearch}
        searchPlaceholder="Search items by box number or name..."
        trailing={
          <div className="text-sm font-medium text-muted-foreground bg-white px-3 py-1.5 rounded border border-slate-200 shadow-sm">
            Total Items: <span className="text-orns-red font-bold">{activeItems.length}</span>
          </div>
        }
      />
      <ListPageCard icon={<Tag className="w-5 h-5 text-primary" />} title="Auction Catalog" description={`Every item in the ${year} auction and who won it.`} contentClassName="p-0">
        <ItemsList
          items={filteredItems}
          loading={loading}
          hasActiveSearch={itemSearch.length > 0}
          winners={data.winners}
          unwonLabel="No winner"
        />
      </ListPageCard>
    </div>
  );

  const noShows = (
    <ListPageCard
      icon={<UserX className="w-5 h-5 text-primary" />}
      title="No-Shows"
      description={`Bidders registered for the ${year} auction who never checked in (proxy bidders are not counted).`}
      contentClassName="p-0"
    >
      <RowListShell
        items={attendance.noShows}
        loading={loading}
        emptyIcon={<UserCheck className="w-7 h-7" />}
        emptyMessage="Everyone registered checked in."
        renderRow={(b) => <ArchivedBidderRow key={b.id} bidder={b} />}
      />
    </ListPageCard>
  );

  const noBids = (
    <ListPageCard
      icon={<PackageX className="w-5 h-5 text-primary" />}
      title="No Bid Items"
      description={`Items in the ${year} auction that never got a winning bid. Raffle tickets, open appeal and auction tickets are left out.`}
      contentClassName="p-0"
    >
      <ItemsList
        items={noBidItems}
        loading={loading}
        hasActiveSearch={false}
        winners={{}}
        unwonLabel="No winner"
        emptyMessage={auction.itemsSpreadsheetId ? "Every item received a winning bid." : `No "${year} Auction Items" spreadsheet was found, so there are no items to check.`}
      />
    </ListPageCard>
  );

  const panels: Record<Section, React.ReactNode> = { overview, check_in: checkIn, catalog, no_shows: noShows, no_bids: noBids };

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start">
      <VerticalNav
        label={`${year} auction sections`}
        value={section}
        onValueChange={(v) => setSection(v as Section)}
        items={[
          { value: "overview", label: "Overview", icon: <BarChart3 className="w-4 h-4" /> },
          { value: "check_in", label: "Bidder Check-In", icon: <UserCheck className="w-4 h-4" />, badge: loading ? undefined : data.bidders.length },
          { value: "catalog", label: "Auction Catalog", icon: <Tag className="w-4 h-4" />, badge: loading ? undefined : activeItems.length },
          { value: "no_shows", label: "No-Shows", icon: <UserX className="w-4 h-4" />, badge: loading ? undefined : attendance.noShows.length },
          { value: "no_bids", label: "No Bid Items", icon: <PackageX className="w-4 h-4" />, badge: loading ? undefined : noBidItems.length },
        ]}
      />
      <div className="flex-1 min-w-0 w-full">{panels[section]}</div>
    </div>
  );
}
