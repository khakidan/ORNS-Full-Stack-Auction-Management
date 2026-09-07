import { ReactNode } from "react";

interface AuctionItemFormSectionProps {
  title: string;
  children: ReactNode;
}

/**
 * Shared section wrapper (uppercase label + grouped fields) for the Add
 * and Edit Auction Item dialogs, so the two forms read as one visual
 * workflow even though they collect different fields - Edit exposes the
 * sheet row's Item # and the computed Opening Bid/Min Raise for manual
 * override, while Add lets the server calculate those from Value alone
 * (see itemService.ts's calculateBidAmounts) and has no Item # yet.
 */
export function AuctionItemFormSection({ title, children }: AuctionItemFormSectionProps) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">{title}</div>
      {children}
    </div>
  );
}
