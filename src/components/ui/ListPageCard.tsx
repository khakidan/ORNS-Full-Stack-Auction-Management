import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ListPageCardProps {
  icon?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

/**
 * Shared Card/CardHeader/CardContent skeleton for this app's four
 * search-and-list workflow pages (Items.tsx, Bidders.tsx,
 * TicketAttendeeTab.tsx, AuctionItemsTab.tsx - see
 * CHANGELOG.md's "UI / Layout Tweaks" item). Each of those
 * pages independently hand-rolled the identical
 * `<Card><CardHeader>{icon+title+description}</CardHeader>
 * <CardContent className="p-0">{list}</CardContent></Card>` shape, and
 * that duplication is exactly what let a bare `CardHeader` drift into a
 * redundant `className="pb-3"`/`"py-6"` override on individual pages -
 * `Card`'s own `flex flex-col gap-4` already provides the header-to-
 * content gap, so any per-page override on top of it silently
 * double-spaces (see CHANGELOG.md's whitespace bug fixes). Centralizing
 * the skeleton here removes the surface area for that bug class to
 * recur: every consumer gets the same bare header spacing by
 * construction, with no className slot for it to override away.
 *
 * Deliberately does not include the search/filter bar above the Card -
 * that's `FilterToolbar.tsx`, a separate, already-shared component
 * composed as this component's sibling, not its child.
 */
export function ListPageCard({
  icon,
  title,
  description,
  className,
  contentClassName,
  children,
}: ListPageCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className={icon ? "flex items-center gap-2" : undefined}>
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className={cn("p-0", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
