import { Banknote, Check, CreditCard, NotebookPen } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { cn } from "@/lib/utils";
import { WinnerRecord } from "@/hooks/useCheckoutState";

const PAYMENT_METHODS = [
  { value: "Cash", icon: Banknote },
  { value: "Check", icon: NotebookPen },
  { value: "Credit Card/PayPal", icon: CreditCard },
] as const;

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
        <div className="grid grid-cols-1 gap-2 py-4">
          {PAYMENT_METHODS.map(({ value, icon: Icon }) => {
            const isSelected = paymentMethod === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onPaymentMethodChange(value)}
                className={cn(
                  "flex items-center gap-3 w-full px-4 py-3 rounded-lg border text-sm font-medium transition-colors",
                  isSelected
                    ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                    : "border-input bg-transparent hover:bg-accent"
                )}
              >
                <Icon className={cn("w-4.5 h-4.5", isSelected ? "text-emerald-600" : "text-muted-foreground")} />
                <span className="flex-1 text-left">{value === "Credit Card/PayPal" ? "Credit Card / PayPal" : value}</span>
                <span
                  className={cn(
                    "w-4.5 h-4.5 rounded-full border flex items-center justify-center shrink-0",
                    isSelected ? "bg-emerald-500 border-emerald-500" : "border-input"
                  )}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </span>
              </button>
            );
          })}
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
