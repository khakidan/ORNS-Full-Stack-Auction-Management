import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatTileProps {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  valueClassName?: string;
  subtext?: ReactNode;
}

/**
 * Shared KPI stat-tile Card, extracted out of DashboardStatsRow.tsx and
 * CheckoutStatsRow.tsx - CheckoutStatsRow.tsx's own docblock previously
 * said it was written to match DashboardStatsRow.tsx's "exact pattern"
 * on purpose, i.e. duplicated rather than shared (see
 * CHANGELOG.md's 2026-09-07 audit). `value`/`subtext`
 * accept any ReactNode, not just text, since a couple of tiles
 * (Checkout Status's "N Pending / of M Present" row, Total Raised's
 * plain currency string) need more than a single string.
 */
export function StatTile({ label, icon, value, valueClassName, subtext }: StatTileProps) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", valueClassName)}>{value}</div>
        {subtext}
      </CardContent>
    </Card>
  );
}
