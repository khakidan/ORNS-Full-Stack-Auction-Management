import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { FormSection } from "@/components/FormSection";
import { AttendeeGuestsEditor, GuestDraft } from "@/components/AttendeeGuestsEditor";
import { hasMoreGuestsThanTicketsPurchased } from "@/lib/attendeeValidation";
import { Attendee } from "@/types";

export interface AttendeeEditDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ticketsPurchased: string;
  paymentStatus: string;
  paymentMethod: string;
  totalPaid: string;
  guests: GuestDraft[];
}

const EMPTY_DRAFT: AttendeeEditDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  ticketsPurchased: "0",
  paymentStatus: "Pending",
  paymentMethod: "",
  totalPaid: "",
  guests: [],
};

function toDraft(attendee: Attendee): AttendeeEditDraft {
  return {
    firstName: attendee.firstName,
    lastName: attendee.lastName,
    email: attendee.email,
    phone: attendee.phone,
    ticketsPurchased: attendee.ticketsPurchased,
    paymentStatus: attendee.paymentStatus,
    paymentMethod: attendee.paymentMethod,
    totalPaid: attendee.totalPaid,
    guests: attendee.guestsInfo.map(g => ({
      guestIndex: g.guestIndex as GuestDraft["guestIndex"],
      name: g.name,
      firstName: g.firstName,
      lastName: g.lastName,
      email: g.email,
      ownBidderNumber: g.ownBidderNumber,
    })),
  };
}

interface EditAttendeeDialogProps {
  attendee: Attendee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: AttendeeEditDraft) => void | Promise<void>;
  isSaving: boolean;
}

/**
 * Covers every editable aspect of an attendee's ticket-sheet row in one
 * dialog - contact info, tickets purchased, up to 3 guests (add/remove/
 * edit, plus each guest's own-bidder-number opt-in), and payment - per
 * the "Attendee Tickets workflow challenges" bug report ("no way to edit
 * the number of tickets", "no way to add guests"). Mirrors
 * AddAttendeeDialog.tsx's layout via the shared FormSection/
 * AttendeeGuestsEditor components. Payment Method/Total Paid and "own
 * bidder number" only apply to the general "tickets" sheet - see
 * attendeeSheetColumns.ts's docblock for why staff/sponsor rows can't
 * meaningfully support them.
 */
export function EditAttendeeDialog({ attendee, open, onOpenChange, onSave, isSaving }: EditAttendeeDialogProps) {
  const [draft, setDraft] = useState<AttendeeEditDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (attendee) setDraft(toDraft(attendee));
  }, [attendee]);

  const isGeneralTickets = attendee?.sheet === "tickets";
  const guestsExceedTickets = hasMoreGuestsThanTicketsPurchased({ guestsInfo: draft.guests, ticketsPurchased: draft.ticketsPurchased });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Attendee</DialogTitle>
          <DialogDescription>Update contact details, tickets, guests, and payment.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 max-h-[65vh] overflow-y-auto pr-1">
          <FormSection title="Contact">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">First name</Label>
                <Input value={draft.firstName} onChange={e => setDraft({ ...draft, firstName: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Last name</Label>
                <Input value={draft.lastName} onChange={e => setDraft({ ...draft, lastName: e.target.value })} />
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Email</Label>
              <Input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} />
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Phone</Label>
              <Input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} />
            </div>
          </FormSection>

          <FormSection title="Tickets">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Tickets Purchased</Label>
              <Input type="number" min="0" value={draft.ticketsPurchased} onChange={e => setDraft({ ...draft, ticketsPurchased: e.target.value })} />
            </div>
          </FormSection>

          <FormSection title="Guests">
            <AttendeeGuestsEditor
              guests={draft.guests}
              onChange={(guests) => setDraft({ ...draft, guests })}
              allowOwnBidderNumber={isGeneralTickets}
            />
            {guestsExceedTickets && (
              <p className="text-xs text-red-600 mt-2">
                {draft.guests.length} guests listed but only {draft.ticketsPurchased || 0} ticket(s) purchased - increase Tickets Purchased or remove a guest before saving.
              </p>
            )}
          </FormSection>

          <FormSection title="Payment">
            <div className="inline-flex rounded-lg border p-0.5 gap-0.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-7", draft.paymentStatus === "Paid" && "bg-green-600 text-white hover:bg-green-600 hover:text-white")}
                onClick={() => setDraft({ ...draft, paymentStatus: "Paid" })}
              >
                Paid
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn("h-7", draft.paymentStatus !== "Paid" && "bg-amber-600 text-white hover:bg-amber-600 hover:text-white")}
                onClick={() => setDraft({ ...draft, paymentStatus: "Pending" })}
              >
                Pending
              </Button>
            </div>
            {isGeneralTickets ? (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Payment Method</Label>
                  <Input value={draft.paymentMethod} onChange={e => setDraft({ ...draft, paymentMethod: e.target.value })} placeholder="Manual, Credit Card, ..." />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Total Paid</Label>
                  <Input value={draft.totalPaid} onChange={e => setDraft({ ...draft, totalPaid: e.target.value })} placeholder="$0" />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-3">Staff and Sponsor tickets are always marked Comp / Paid.</p>
            )}
          </FormSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton onClick={() => onSave(draft)} loading={isSaving} disabled={guestsExceedTickets}>Save Changes</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
