import { Badge } from "@/components/ui/badge";
import { Bidder } from "@/types";
import { RowIdTile } from "@/components/RowIdTile";

/** Read-only bidder row for a past auction: who they were, and whether they showed. */
export function ArchivedBidderRow({ bidder }: { bidder: Bidder }) {
  const status = bidder.isProxy
    ? { label: "Proxy", className: "bg-blue-50 text-blue-700 border-blue-200" }
    : bidder.checkedIn
      ? { label: "Checked In", className: "bg-emerald-50 text-emerald-700 border-emerald-200" }
      : { label: "No-Show", className: "bg-amber-50 text-amber-700 border-amber-200" };

  return (
    <div
      data-testid={`archived-bidder-row-${bidder.id}`}
      className="flex items-center gap-4 px-5 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors"
    >
      <RowIdTile value={bidder.id} caption="ID" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-row-title truncate">{bidder.firstName} {bidder.lastName}</div>
        <div className="text-sm text-muted-foreground truncate">{bidder.email || "No email on file"}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {bidder.checkedOut && bidder.paid && (
          <Badge variant="outline" className="text-xs font-normal">Paid</Badge>
        )}
        <Badge variant="outline" className={`text-xs font-normal ${status.className}`}>{status.label}</Badge>
      </div>
    </div>
  );
}
