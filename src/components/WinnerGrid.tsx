import { Card } from "@/components/ui/card";
import { Receipt } from "lucide-react";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";
import { WinnerCard } from "@/components/WinnerCard";
import { Bidder } from "@/types";
import { WinnerRecord } from "@/hooks/useCheckoutState";

interface WinnerGridProps {
  winners: WinnerRecord[];
  loading: boolean;
  bidders: Bidder[];
  processingId: string | null;
  payingBidderId: string | null;
  onEmailReceipt: (winner: WinnerRecord) => void;
  onPrintReceipt: (winner: WinnerRecord) => void;
  onMarkPaid: (winner: WinnerRecord) => void;
}

/**
 * Responsive card grid for one checkout tab (pending or completed):
 * skeleton cards while loading, an empty-state placeholder when there
 * are no matching winners, or the real WinnerCard list. This is a
 * winner *card grid*, not a <Table> - see refactor-opportunities.md's
 * note on why DataTableWrapper doesn't apply to Checkout.tsx.
 */
export function WinnerGrid({
  winners,
  loading,
  bidders,
  processingId,
  payingBidderId,
  onEmailReceipt,
  onPrintReceipt,
  onMarkPaid,
}: WinnerGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse bg-slate-100 h-62.5" />
        ))
      ) : winners.length > 0 ? (
        winners.map((winner) => {
          const bidderInfo = bidders.find(b => b.id === winner.bidderId);
          const hasEmail = !!bidderInfo?.email && bidderInfo.email.trim() !== "";
          return (
            <WinnerCard
              key={winner.bidderId}
              winner={winner}
              hasEmail={hasEmail}
              processingId={processingId}
              payingBidderId={payingBidderId}
              onEmailReceipt={onEmailReceipt}
              onPrintReceipt={onPrintReceipt}
              onMarkPaid={onMarkPaid}
            />
          );
        })
      ) : (
        <StatusStatePlaceholder
          className="col-span-full"
          icon={<Receipt />}
          description="No winners found in this category."
        />
      )}
    </div>
  );
}
