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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/FormSection";
import { FormField } from "@/components/FormField";
import { AttendeeGuestsEditor, GuestDraft } from "@/components/AttendeeGuestsEditor";
import { hasMoreGuestsThanTicketsPurchased } from "@/lib/attendeeValidation";

// SelectValue with no children renders the raw stored value, not the
// matching SelectItem's label - see component-standards.md's documented
// SelectValue failure mode. Confirmed via a throwaway RTL render that
// the trigger showed the literal "sponsor tickets" instead of "Sponsor".
const SOURCE_LABELS: Record<string, string> = {
  "tickets": "General Tickets",
  "sponsor tickets": "Sponsor",
  "staff tickets": "Staff",
};

export interface NewAttendeeEntry {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  tickets: string;
  guests: GuestDraft[];
}

interface AddAttendeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newEntry: NewAttendeeEntry;
  onNewEntryChange: (entry: NewAttendeeEntry) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

/**
 * Mirrors EditAttendeeDialog.tsx's sectioned layout (via the shared
 * FormSection) and reuses the same AttendeeGuestsEditor for guest
 * collection at creation time - per the "Attendee Tickets workflow
 * challenges" bug report ("no way to indicate...that the bidder wishes
 * to have guests - and if that guest wants to have their own bidder
 * number"). "Own bidder number" only shows for General Tickets, since
 * Staff/Sponsor sheets have no column for it (attendeeSheetColumns.ts).
 */
export function AddAttendeeDialog({
  open,
  onOpenChange,
  newEntry,
  onNewEntryChange,
  onSubmit,
  isSubmitting,
}: AddAttendeeDialogProps) {
  const guestsExceedTickets = hasMoreGuestsThanTicketsPurchased({ guestsInfo: newEntry.guests, ticketsPurchased: newEntry.tickets });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button className="gap-2 w-full md:w-auto">
            <UserPlus className="w-4 h-4" />
            Add Entry
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Entry</DialogTitle>
          <DialogDescription>Manually add a sponsor, staff member, or offline ticket buyer.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 max-h-[65vh] overflow-y-auto pr-1">
          <FormSection title="Contact">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="First name">
                {(id) => (
                  <Input id={id} placeholder="First" value={newEntry.firstName} onChange={e => onNewEntryChange({ ...newEntry, firstName: e.target.value })} />
                )}
              </FormField>
              <FormField label="Last name">
                {(id) => (
                  <Input id={id} placeholder="Last" value={newEntry.lastName} onChange={e => onNewEntryChange({ ...newEntry, lastName: e.target.value })} />
                )}
              </FormField>
            </div>
            <FormField label="Email" className="mt-3">
              {(id) => (
                <Input id={id} value={newEntry.email} onChange={e => onNewEntryChange({ ...newEntry, email: e.target.value })} />
              )}
            </FormField>
            <FormField label="Phone" className="mt-3">
              {(id) => (
                <Input id={id} value={newEntry.phone} onChange={e => onNewEntryChange({ ...newEntry, phone: e.target.value })} />
              )}
            </FormField>
          </FormSection>

          <FormSection title="Tickets">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Source">
                {(id) => (
                  <Select value={newEntry.source} onValueChange={v => onNewEntryChange({ ...newEntry, source: v })}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue>{(value: string) => SOURCE_LABELS[value] ?? value}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tickets">General Tickets</SelectItem>
                      <SelectItem value="sponsor tickets">Sponsor</SelectItem>
                      <SelectItem value="staff tickets">Staff</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="Tickets Purchased">
                {(id) => (
                  <Input id={id} type="number" min="0" value={newEntry.tickets} onChange={e => onNewEntryChange({ ...newEntry, tickets: e.target.value })} />
                )}
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Guests">
            <AttendeeGuestsEditor
              guests={newEntry.guests}
              onChange={(guests) => onNewEntryChange({ ...newEntry, guests })}
              allowOwnBidderNumber={newEntry.source === "tickets"}
            />
            {guestsExceedTickets && (
              <p className="text-xs text-red-600 mt-2">
                {newEntry.guests.length} guests listed but only {newEntry.tickets || 0} ticket(s) purchased - increase Tickets Purchased or remove a guest before saving.
              </p>
            )}
          </FormSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton onClick={onSubmit} loading={isSubmitting} disabled={guestsExceedTickets}>Save Entry</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
