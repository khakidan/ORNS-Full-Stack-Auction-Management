import { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface RefreshableListCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  loading: boolean;
  onRefresh: () => void;
  children: ReactNode;
}

/**
 * Shared page shell for Receipts.tsx and BugReportsAdmin.tsx - both
 * hand-rolled the same Card/CardHeader (icon + title + description on
 * the left, a spinning-on-refresh Button on the right)/CardContent
 * skeleton around a DataTableWrapper body, instead of using
 * ListPageCard.tsx (built for the four search-and-list pages, but not
 * this "list + refresh button, no search/filter" shape). See
 * refactor-opportunities.md's 2026-09-07 audit.
 */
export function RefreshableListCard({ icon, title, description, loading, onRefresh, children }: RefreshableListCardProps) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="text-xl flex items-center gap-2">
            {icon}
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-2">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
