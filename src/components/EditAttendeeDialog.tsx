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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Attendee } from "@/types";

export interface EditGuestDraft {
  guestIndex: number;
  firstName: string;
  lastName: string;
  email: string;
  ownBidderNumber: string;
}

export interface AttendeeEditDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  paymentStatus: string;
  guests: EditGuestDraft[];
}

const EMPTY_DRAFT: AttendeeEditDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  paymentStatus: "Pending",
  guests: [],
};

function toDraft(attendee: Attendee): AttendeeEditDraft {
  return {
    firstName: attendee.firstName,
    lastName: attendee.lastName,
    email: attendee.email,
    phone: attendee.phone,
    paymentStatus: attendee.paymentStatus,
    guests: attendee.guestsInfo.map(g => ({
      guestIndex: g.guestIndex,
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
 * Replaces the per-field inline editors that used to live in
 * AttendeeRow.tsx (see the "Attendee List UI Layout Issues" bug report)
 * with a single dialog covering contact info, every guest, and payment
 * status at once.
 */
export function EditAttendeeDialog({ attendee, open, onOpenChange, onSave, isSaving }: EditAttendeeDialogProps) {
  const [draft, setDraft] = useState<AttendeeEditDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (attendee) setDraft(toDraft(attendee));
  }, [attendee]);

  const updateGuest = (index: number, field: "firstName" | "lastName" | "email", value: string) => {
    setDraft(prev => ({
      ...prev,
      guests: prev.guests.map((g, i) => (i === index ? { ...g, [field]: value } : g)),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Attendee</DialogTitle>
          <DialogDescription>Update contact details, guests, and whether they've paid.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Contact</div>
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
          </div>

          {draft.guests.length > 0 ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Guests</div>
              <div className="flex flex-col gap-2">
                {draft.guests.map((g, idx) => (
                  <div key={g.guestIndex} className="border rounded-lg p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">Guest {idx + 1}</span>
                      {g.ownBidderNumber?.toLowerCase() === "yes" && (
                        <Badge variant="secondary" className="text-xxs h-4 px-1.5 font-normal bg-indigo-50 text-indigo-700 border-indigo-200">
                          Own bidder #
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="First" value={g.firstName} onChange={e => updateGuest(idx, "firstName", e.target.value)} />
                      <Input placeholder="Last" value={g.lastName} onChange={e => updateGuest(idx, "lastName", e.target.value)} />
                    </div>
                    <Input placeholder="Guest email" value={g.email} onChange={e => updateGuest(idx, "email", e.target.value)} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground italic">No guests on this entry.</span>
          )}

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Payment</div>
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton onClick={() => onSave(draft)} loading={isSaving}>Save Changes</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
