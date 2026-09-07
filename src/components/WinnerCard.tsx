import { CheckCircle2, Clock, Loader2, Mail, Receipt } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { cn } from "@/lib/utils";
import { WinnerRecord } from "@/hooks/useCheckoutState";

interface WinnerCardProps {
  winner: WinnerRecord;
  hasEmail: boolean;
  processingId: string | null;
  payingBidderId: string | null;
  onEmailReceipt: (winner: WinnerRecord) => void;
  onPrintReceipt: (winner: WinnerRecord) => void;
  onMarkPaid: (winner: WinnerRecord) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function WinnerCard({
  winner,
  hasEmail,
  processingId,
  payingBidderId,
  onEmailReceipt,
  onPrintReceipt,
  onMarkPaid,
}: WinnerCardProps) {
  const isProcessingThisWinner = !!processingId && processingId.startsWith(`${winner.bidderId}-`);
  // useCheckoutState.confirmMarkPaid closes the payment dialog immediately
  // (before its background sync settles), so isSubmittingPayment's own
  // in-flight window falls entirely after handleMarkPaid's dialog-open
  // click - there's no async gap on this button's own click to show a
  // spinner for. What this button CAN reflect is that later window: once
  // the dialog closes, the "Checkout" button re-appears for a moment
  // while the sync is still running, before winner.paid/paymentPending
  // updates and this branch stops rendering it at all.
  const isPayingThisWinner = payingBidderId === winner.bidderId;

  const status = winner.paid ? "paid" : winner.paymentPending ? "review" : "awaiting";

  return (
    <Card
      className={cn(
        "flex flex-col h-full shadow-sm hover:shadow-md transition-shadow border-l-4 py-0 gap-0",
        status === "paid" && "border-l-emerald-500",
        status === "review" && "border-l-amber-500",
        status === "awaiting" && "border-l-muted-foreground/30"
      )}
    >
      <CardHeader className="pt-4 pb-3 gap-0">
        <div className="flex justify-between items-start gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-secondary text-secondary-foreground flex items-center justify-center font-bold text-sm shrink-0">
              {initials(winner.name)}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[15px] truncate">{winner.name}</div>
              <div className="text-xs text-muted-foreground">Bidder #{winner.bidderId}</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-bold text-primary">${winner.total.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{winner.items.length} item{winner.items.length === 1 ? "" : "s"} won</div>
          </div>
        </div>
      </CardHeader>

      <div className="px-4 pb-2">
        {status === "awaiting" && (
          <Badge variant="outline" className="text-xs font-normal gap-1.5 text-muted-foreground">
            <Clock className="w-3 h-3" /> Awaiting checkout
          </Badge>
        )}
        {status === "review" && (
          <Badge variant="outline" className="text-xs font-normal gap-1.5 bg-amber-50 text-amber-700 border-amber-200">
            <Loader2 className="w-3 h-3 animate-spin" /> Pending verification
          </Badge>
        )}
        {status === "paid" && (
          <Badge variant="outline" className="text-xs font-normal gap-1.5 bg-emerald-50 text-emerald-700 border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Paid
          </Badge>
        )}
      </div>

      <CardContent className="flex-1 py-0 px-4">
        <ul className="space-y-1.5 max-h-26 overflow-y-auto pr-1">
          {winner.items.map((item, i: number) => (
            <li key={i} className="flex justify-between gap-3 text-sm">
              <span className="text-muted-foreground truncate">{item.name}</span>
              <span className="font-medium shrink-0">${item.price.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="pt-3 pb-4 mt-3 border-t flex-col items-stretch gap-2 bg-muted/30">
        <div className="flex gap-2">
          <LoadingButton
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => onEmailReceipt(winner)}
            disabled={!hasEmail || isProcessingThisWinner}
            loading={processingId === `${winner.bidderId}-email`}
            loadingText="Sending..."
            icon={<Mail className="w-3.5 h-3.5" />}
            title={!hasEmail ? "No email on file for this bidder" : ""}
          >
            {hasEmail ? "Email Receipt" : "No Email"}
          </LoadingButton>
          <LoadingButton
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 text-xs"
            onClick={() => onPrintReceipt(winner)}
            disabled={isProcessingThisWinner}
            loading={processingId === `${winner.bidderId}-print`}
            loadingText="Printing..."
            icon={<Receipt className="w-3.5 h-3.5" />}
          >
            Print Receipt
          </LoadingButton>
        </div>
        {winner.paid ? (
          <>
            <div className="w-full py-2 text-center text-emerald-600 font-medium flex items-center justify-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4" /> Paid
            </div>
            {winner.paymentMethod && (
              <div className="text-xs text-muted-foreground text-center -mt-1">via {winner.paymentMethod}</div>
            )}
          </>
        ) : winner.paymentPending ? (
          <div className="w-full py-2 text-center text-amber-600 font-medium flex items-center justify-center gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Pending Verification
          </div>
        ) : (
          <LoadingButton
            size="sm"
            className="w-full gap-2"
            onClick={() => onMarkPaid(winner)}
            disabled={isProcessingThisWinner || isPayingThisWinner}
            loading={isPayingThisWinner}
            loadingText="Processing..."
            icon={<CheckCircle2 className="w-4 h-4" />}
          >
            Checkout
          </LoadingButton>
        )}
      </CardFooter>
    </Card>
  );
}
