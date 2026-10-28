import { useState } from "react";
import { BarChart3, FolderOpen, Tag, UserCheck, UserX, PackageX } from "lucide-react";
import { useConfig } from "@/context/ConfigContext";
import { useArchivedAuctionData } from "@/hooks/useArchivedAuctionData";
import { ArchivedAuction } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { VerticalNav } from "@/components/VerticalNav";
import { ArchivedOverviewSection } from "@/components/ArchivedOverviewSection";
import { ArchivedCatalogSection, ArchivedCheckInSection, ArchivedNoBidsSection, ArchivedNoShowsSection } from "@/components/ArchivedListSections";

type Section = "overview" | "check_in" | "catalog" | "no_shows" | "no_bids";

const byId = (a: { id: string }, b: { id: string }) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);

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
  const activeItems = data.items.filter((i) => i.status === "Active").sort(byId);

  const term = bidderSearch.toLowerCase();
  const filteredBidders = data.bidders
    .filter((b) => {
      if (statusFilter === "checked-in" && !b.checkedIn) return false;
      if (statusFilter === "no-show" && (b.checkedIn || b.isProxy)) return false;
      if (statusFilter === "proxy" && !b.isProxy) return false;
      return !term || b.id.includes(term) || `${b.firstName} ${b.lastName}`.toLowerCase().includes(term) || b.email.toLowerCase().includes(term);
    })
    .sort(byId);

  // Multi-winner items (raffle tickets, open appeal, auction tickets) are
  // sold many times over, so "no winner" doesn't mean they went unsold.
  const singleWinnerItems = activeItems.filter((i) => !i.allowMultipleWinners);
  const noBidItems = singleWinnerItems.filter((i) => !data.winners[i.id]);

  const filteredItems = activeItems.filter(
    (i) => i.id.includes(itemSearch) || i.name.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const panels: Record<Section, React.ReactNode> = {
    overview: <ArchivedOverviewSection auction={auction} data={data} noBidCount={noBidItems.length} singleWinnerCount={singleWinnerItems.length} />,
    check_in: (
      <ArchivedCheckInSection
        year={year}
        bidders={filteredBidders}
        loading={loading}
        search={bidderSearch}
        onSearchChange={setBidderSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />
    ),
    catalog: (
      <ArchivedCatalogSection
        auction={auction}
        allItemsCount={data.items.length}
        activeCount={activeItems.length}
        items={filteredItems}
        winners={data.winners}
        loading={loading}
        search={itemSearch}
        onSearchChange={setItemSearch}
      />
    ),
    no_shows: <ArchivedNoShowsSection year={year} noShows={attendance.noShows} loading={loading} />,
    no_bids: <ArchivedNoBidsSection auction={auction} items={noBidItems} loading={loading} />,
  };

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
