import { CircleDollarSign, Clock, Trophy, Wallet } from "lucide-react";
import { StatTile } from "@/components/StatTile";

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
 * Checkout-page KPI row, sharing StatTile.tsx with DashboardStatsRow.tsx
 * - all four numbers were already derivable from data the page loads,
 * but only "Total Winners" was surfaced before (as a small badge in the
 * old combined toolbar). See CHANGELOG.md for the full redesign rationale.
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
      <StatTile
        label="Total Winners"
        icon={<Trophy className="w-4 h-4 text-muted-foreground" />}
        value={totalWinners}
      />

      <StatTile
        label="Awaiting Checkout"
        icon={<Clock className="w-4 h-4 text-amber-500" />}
        value={awaitingCount}
        valueClassName="text-amber-600 dark:text-amber-500"
        subtext={<p className="text-xs text-muted-foreground mt-1">not yet started</p>}
      />

      <StatTile
        label="Checked Out"
        icon={<Wallet className="w-4 h-4 text-emerald-500" />}
        value={checkedOutCount}
        valueClassName="text-emerald-600 dark:text-emerald-500"
        subtext={<p className="text-xs text-muted-foreground mt-1">paid or verifying</p>}
      />

      <StatTile
        label="Total Collected"
        icon={<CircleDollarSign className="w-4 h-4 text-orns-red" />}
        value={formatCurrency(totalCollected)}
        valueClassName="text-orns-red"
        subtext={<p className="text-xs text-muted-foreground mt-1">of {formatCurrency(totalWon)} won</p>}
      />
    </div>
  );
}
