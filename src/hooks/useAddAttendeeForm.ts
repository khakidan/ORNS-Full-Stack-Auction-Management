import { useState } from "react";
import { toast } from "sonner";
import { hasMoreGuestsThanTicketsPurchased } from "@/lib/attendeeValidation";
import { guestRowIndicesForSheet } from "@/lib/attendeeSheetColumns";
import { NewAttendeeEntry } from "@/components/AddAttendeeDialog";

const EMPTY_NEW_ENTRY: NewAttendeeEntry = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  source: "tickets",
  tickets: "1",
  guests: [],
};

/**
 * The Add Attendee dialog: its form, and turning the form into the new
 * sheet row. Split out of useTicketAttendeeState.ts.
 */
export function useAddAttendeeForm(addAttendee: (source: string, row: string[]) => Promise<void>) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newEntry, setNewEntry] = useState<NewAttendeeEntry>(EMPTY_NEW_ENTRY);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddSubmit = async () => {
    if (!newEntry.firstName || !newEntry.lastName) {
      toast.error("Name is required");
      return;
    }
    if (hasMoreGuestsThanTicketsPurchased({ guestsInfo: newEntry.guests, ticketsPurchased: newEntry.tickets })) {
      toast.error("Guests exceed tickets purchased - adjust before saving.");
      return;
    }

    setIsSubmitting(true);
    try {
      const row = new Array(25).fill("");
      row[0] = newEntry.firstName;
      row[1] = newEntry.lastName;
      row[2] = newEntry.email;
      row[3] = newEntry.phone;
      row[4] = newEntry.tickets;
      row[5] = newEntry.guests.length > 0 ? "yes" : "";

      const rowIndices = guestRowIndicesForSheet(newEntry.source);
      newEntry.guests.forEach((g) => {
        const idx = rowIndices[g.guestIndex];
        row[idx.firstName] = g.firstName;
        row[idx.lastName] = g.lastName;
        row[idx.email] = g.email;
        if (idx.ownBidderNumber !== null) row[idx.ownBidderNumber] = g.ownBidderNumber;
      });

      if (newEntry.source !== 'tickets') {
        // Column order here matches parseAttendeeRows' own unshifted
        // pm/ps/tp columns (Q/R/S) for staff/sponsor sheets - the same
        // columns paymentColumnsForSheet (attendeeSheetColumns.ts) gives
        // edits on those sheets. Values match the parser's own hardcoded Comp/Paid/$0
        // for these sheets (staff/sponsors get free tickets), so the raw
        // sheet stays consistent with what the app displays even though
        // parseAttendeeRows doesn't actually read these columns back for
        // staff/sponsor rows today.
        row[16] = "Comp"; // Payment Method
        row[17] = "Paid"; // Payment Status
        row[18] = "$0";   // Total Paid
      } else {
        row[19] = "Manual";
        row[20] = "Pending";
        row[21] = "$0";
      }

      await addAttendee(newEntry.source, row);
      setIsAddDialogOpen(false);
      setNewEntry(EMPTY_NEW_ENTRY);
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isAddDialogOpen, setIsAddDialogOpen, newEntry, setNewEntry, handleAddSubmit, isSubmitting };
}
