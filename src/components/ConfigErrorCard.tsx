import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";

interface ConfigErrorCardProps {
  icon: ReactNode;
  title: string;
  description: string;
}

/**
 * Shared "required spreadsheet/folder ID isn't configured" placeholder -
 * previously duplicated 3 times (Receipts.tsx, BugReportsAdmin.tsx,
 * AuctionItemsTab.tsx), with AuctionItemsTab.tsx's copy missing the
 * `h-100 flex items-center justify-center` centering the other two had,
 * so its placeholder rendered top-aligned instead of centered - a real,
 * visible drift bug fixed by extracting this single implementation. See
 * CHANGELOG.md's 2026-09-07 audit.
 */
export function ConfigErrorCard({ icon, title, description }: ConfigErrorCardProps) {
  return (
    <Card>
      <CardContent className="h-100 flex items-center justify-center">
        <StatusStatePlaceholder icon={icon} title={title} description={description} />
      </CardContent>
    </Card>
  );
}
