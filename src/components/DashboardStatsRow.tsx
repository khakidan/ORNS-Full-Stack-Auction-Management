import { ShoppingBag, TrendingUp, UserCheck, Users } from "lucide-react";
import { StatTile } from "@/components/StatTile";

interface DashboardStatsRowProps {
  checkedInCount: number;
  totalBidders: number;
  checkedOutCount: number;
  pendingCheckoutCount: number;
  itemsCount: number;
  totalRaised: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function DashboardStatsRow({
  checkedInCount,
  totalBidders,
  checkedOutCount,
  pendingCheckoutCount,
  itemsCount,
  totalRaised,
}: DashboardStatsRowProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatTile
        label="Bidders Present"
        icon={<Users className="w-4 h-4 text-muted-foreground" />}
        value={<>{checkedInCount} / {totalBidders}</>}
        subtext={
          <p className="text-xs text-muted-foreground mt-1">
            {Math.round((checkedInCount / (totalBidders || 1)) * 100)}% attendance
          </p>
        }
      />

      <StatTile
        label="Checkout Status"
        icon={<UserCheck className="w-4 h-4 text-muted-foreground" />}
        value={<>{checkedOutCount} <span className="text-sm font-normal text-muted-foreground">Checked Out</span></>}
        subtext={
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-amber-600 dark:text-amber-500">
              {pendingCheckoutCount} Pending
            </span>
            <span className="text-muted-foreground">
              of {checkedInCount} Present
            </span>
          </div>
        }
      />

      <StatTile
        label="Auction Items"
        icon={<ShoppingBag className="w-4 h-4 text-muted-foreground" />}
        value={itemsCount}
        subtext={<p className="text-xs text-muted-foreground mt-1">In catalog</p>}
      />

      <StatTile
        label="Total Raised"
        icon={<TrendingUp className="w-4 h-4 text-emerald-500" />}
        value={formatCurrency(totalRaised || 0)}
        valueClassName="text-emerald-500"
      />
    </div>
  );
}
