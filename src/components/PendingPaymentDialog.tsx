import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Bidder } from "@/types";

interface PendingPaymentDialogProps {
  pendingCheckIn: Bidder | null;
  onOpenChange: (open: boolean) => void;
  isAddingTicketToReceipt: boolean;
  onConfirm: (addToReceipt: boolean) => void;
}

/**
 * Confirms how to handle checking in a bidder whose ticket payment is
 * still pending. Kept as a real AlertDialog rather than the shared
 * ConfirmationDialog: "No, Do Not Add" still checks the bidder in (just
 * without the receipt addition) - closing the dialog does neither. That
 * Cancel-does-something-real distinction doesn't fit ConfirmationDialog's
 * cancel-just-closes API.
 */
export function PendingPaymentDialog({
  pendingCheckIn,
  onOpenChange,
  isAddingTicketToReceipt,
  onConfirm,
}: PendingPaymentDialogProps) {
  return (
    <AlertDialog
      open={!!pendingCheckIn}
      onOpenChange={(open) => {
        if (!isAddingTicketToReceipt) onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pending Payment Detected</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingCheckIn?.firstName} {pendingCheckIn?.lastName} has not paid for their ticket yet.
            Would you like to add their ticket to their final receipt so they can pay at checkout?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isAddingTicketToReceipt} onClick={() => onConfirm(false)}>
            No, Do Not Add
          </AlertDialogCancel>
          <LoadingButton
            variant="default"
            loading={isAddingTicketToReceipt}
            onClick={() => onConfirm(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Yes, Add to Receipt
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
