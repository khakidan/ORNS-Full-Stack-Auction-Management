import { CircleDollarSign, Clock, Trophy, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CheckoutStatsRowProps {
  totalWinners: number;
  awaitingCount: number;
  checkedOutCount: number;
  totalCollected: number;
  totalWon: number;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Checkout-page KPI row, matching DashboardStatsRow.tsx's exact pattern
 * (same Card/CardHeader/CardTitle+icon/CardContent shape) - all four
 * numbers were already derivable from data the page loads, but only
 * "Total Winners" was surfaced before (as a small badge in the old
 * combined toolbar). See CHANGELOG.md for the full redesign rationale.
 */
export function CheckoutStatsRow({
  totalWinners,
  awaitingCount,
  checkedOutCount,
  totalCollected,
  totalWon,
}: CheckoutStatsRowProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Total Winners</CardTitle>
          <Trophy className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalWinners}</div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Awaiting Checkout</CardTitle>
          <Clock className="w-4 h-4 text-amber-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-500">{awaitingCount}</div>
          <p className="text-xs text-muted-foreground mt-1">not yet started</p>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Checked Out</CardTitle>
          <Wallet className="w-4 h-4 text-emerald-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-500">{checkedOutCount}</div>
          <p className="text-xs text-muted-foreground mt-1">paid or verifying</p>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Total Collected</CardTitle>
          <CircleDollarSign className="w-4 h-4 text-orns-red" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orns-red">{formatCurrency(totalCollected)}</div>
          <p className="text-xs text-muted-foreground mt-1">of {formatCurrency(totalWon)} won</p>
        </CardContent>
      </Card>
    </div>
  );
}
