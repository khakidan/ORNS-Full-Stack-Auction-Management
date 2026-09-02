import { ShoppingBag, TrendingUp, UserCheck, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Bidders Present</CardTitle>
          <Users className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{checkedInCount} / {totalBidders}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {Math.round((checkedInCount / (totalBidders || 1)) * 100)}% attendance
          </p>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Checkout Status</CardTitle>
          <UserCheck className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {checkedOutCount} <span className="text-sm font-normal text-muted-foreground">Checked Out</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-amber-600 dark:text-amber-500">
              {pendingCheckoutCount} Pending
            </span>
            <span className="text-muted-foreground">
              of {checkedInCount} Present
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Auction Items</CardTitle>
          <ShoppingBag className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{itemsCount}</div>
          <p className="text-xs text-muted-foreground mt-1">In catalog</p>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Total Raised</CardTitle>
          <TrendingUp className="w-4 h-4 text-emerald-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-emerald-500">
            {formatCurrency(totalRaised || 0)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
