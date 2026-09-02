import { UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WalkInForm {
  firstName: string;
  lastName: string;
  email: string;
}

interface WalkInTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: WalkInForm;
  onFormChange: (form: WalkInForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
}

export function WalkInTicketDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  onSubmit,
  isSubmitting,
}: WalkInTicketDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button className="gap-2">
            <UserPlus className="w-4 h-4" />
            New Walk-In Ticket
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New Walk-In Ticket</DialogTitle>
            <DialogDescription>
              Enter the details for a new walk-in bidder. This will create a new bidder number and mark them as checked in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="firstName" className="text-right">
                First Name
              </Label>
              <Input
                id="firstName"
                value={form.firstName}
                onChange={(e) => onFormChange({ ...form, firstName: e.target.value })}
                className="col-span-3"
                required
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="lastName" className="text-right">
                Last Name
              </Label>
              <Input
                id="lastName"
                value={form.lastName}
                onChange={(e) => onFormChange({ ...form, lastName: e.target.value })}
                className="col-span-3"
                required
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Optional"
                value={form.email}
                onChange={(e) => onFormChange({ ...form, email: e.target.value })}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <LoadingButton type="submit" loading={isSubmitting} loadingText="Creating...">
              Create Ticket
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
