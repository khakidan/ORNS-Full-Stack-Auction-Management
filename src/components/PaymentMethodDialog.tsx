import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { cn } from "@/lib/utils";
import { WinnerRecord } from "@/hooks/useCheckoutState";

const PAYMENT_METHODS = ["Cash", "Check", "Credit Card/PayPal"] as const;

interface PaymentMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  winnerToPay: WinnerRecord | null;
  paymentMethod: string;
  onPaymentMethodChange: (method: string) => void;
  isSubmitting: boolean;
  onConfirm: () => void;
}

export function PaymentMethodDialog({
  open,
  onOpenChange,
  winnerToPay,
  paymentMethod,
  onPaymentMethodChange,
  isSubmitting,
  onConfirm,
}: PaymentMethodDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select Payment Method</DialogTitle>
          <DialogDescription>
            How is {winnerToPay?.name} paying for their items today?
            Total: <span className="font-bold text-orns-red">${winnerToPay?.total.toFixed(2)}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 py-4">
          {PAYMENT_METHODS.map((method) => (
            <Button
              key={method}
              variant={paymentMethod === method ? "default" : "outline"}
              className={cn(paymentMethod === method && "bg-emerald-600 hover:bg-emerald-700")}
              onClick={() => onPaymentMethodChange(method)}
            >
              {method === "Credit Card/PayPal" ? "Credit Card / PayPal" : method}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton
            onClick={onConfirm}
            disabled={!paymentMethod}
            loading={isSubmitting}
            className="bg-orns-red text-white hover:bg-orns-red/90"
          >
            Confirm Payment
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
