import { ExternalLink, FolderOpen, PackageX, TrendingUp, UserCheck, UserMinus, Users } from "lucide-react";
import { ArchivedAuction } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/StatTile";
import { AttendanceChart } from "@/components/AttendanceChart";
import { useArchivedAuctionData } from "@/hooks/useArchivedAuctionData";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const openSheet = (id: string) => window.open(`https://docs.google.com/spreadsheets/d/${id}`, "_blank", "noopener,noreferrer");

interface ArchivedOverviewSectionProps {
  auction: ArchivedAuction;
  data: ReturnType<typeof useArchivedAuctionData>;
  /** Items that never got a winning bid, and how many single-winner items there were. */
  noBidCount: number;
  singleWinnerCount: number;
}

/** A past auction's headline numbers, attendance chart and links to its archived files. */
export function ArchivedOverviewSection({ auction, data, noBidCount, singleWinnerCount }: ArchivedOverviewSectionProps) {
  const { year } = auction;
  const { attendance } = data;
  const attendanceStats = [
    { name: "Checked In", value: attendance.checkedIn, fill: "var(--chart-1)" },
    { name: "No-Show", value: attendance.noShows.length, fill: "var(--chart-3)" },
    { name: "Proxy", value: attendance.proxies, fill: "var(--chart-2)" },
  ];

  return (
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
          value={auction.itemsSpreadsheetId ? noBidCount : "N/A"}
          valueClassName={auction.itemsSpreadsheetId ? "text-amber-600" : undefined}
          subtext={
            <p className="text-xs text-muted-foreground mt-1">
              {auction.itemsSpreadsheetId ? `of ${singleWinnerCount} auction items` : "No Auction Items spreadsheet"}
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
            {auction.bidManagementSpreadsheetId && (
              <Button variant="outline" className="justify-start gap-2" onClick={() => openSheet(auction.bidManagementSpreadsheetId!)}>
                <ExternalLink className="w-4 h-4" /> Open {year} Bid Management
              </Button>
            )}
            {auction.itemsSpreadsheetId && (
              <Button variant="outline" className="justify-start gap-2" onClick={() => openSheet(auction.itemsSpreadsheetId!)}>
                <ExternalLink className="w-4 h-4" /> Open {year} Auction Items
              </Button>
            )}
            {auction.actionHistorySpreadsheetId && (
              <Button variant="outline" className="justify-start gap-2" onClick={() => openSheet(auction.actionHistorySpreadsheetId!)}>
                <ExternalLink className="w-4 h-4" /> Open {year} Action History
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
