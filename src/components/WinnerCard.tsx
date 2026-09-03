import { CheckCircle2, Loader2, Mail, Receipt } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingButton } from "@/components/ui/LoadingButton";
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

  return (
    <Card className="flex flex-col h-full shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="pb-2 border-b">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-xl">{winner.name}</CardTitle>
            <CardDescription>Bidder #{winner.bidderId}</CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">${winner.total.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{winner.items.length} items won</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 py-4">
        <ul className="space-y-2">
          {winner.items.map((item, i: number) => (
            <li key={i} className="flex justify-between text-sm">
              <span className="text-muted-foreground max-w-[70%] truncate">{item.name}</span>
              <span className="font-medium">${item.price.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="pt-4 border-t flex-wrap gap-2 bg-slate-50/50">
        <LoadingButton
          variant="outline"
          size="sm"
          className="flex-1 min-w-[100px] gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => onEmailReceipt(winner)}
          disabled={!hasEmail || isProcessingThisWinner}
          loading={processingId === `${winner.bidderId}-email`}
          loadingText="Sending..."
          icon={<Mail className="w-4 h-4" />}
          title={!hasEmail ? "No email on file for this bidder" : ""}
        >
          Email Receipt
        </LoadingButton>
        <LoadingButton
          variant="outline"
          size="sm"
          className="flex-1 min-w-[100px] gap-2"
          onClick={() => onPrintReceipt(winner)}
          disabled={isProcessingThisWinner}
          loading={processingId === `${winner.bidderId}-print`}
          loadingText="Printing..."
          icon={<Receipt className="w-4 h-4" />}
        >
          Print Receipt
        </LoadingButton>
        {winner.paid ? (
          <div className="w-full py-2 text-center text-emerald-600 font-medium flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Paid
          </div>
        ) : winner.paymentPending ? (
          <div className="w-full py-2 text-center text-amber-600 font-medium flex items-center justify-center gap-2">
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
