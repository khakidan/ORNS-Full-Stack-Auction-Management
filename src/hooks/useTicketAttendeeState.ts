import { useMemo, useState } from "react";
import { toast } from "sonner";
import { updateSheetData } from "@/services/google-api";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { Attendee } from "@/types";

interface NewAttendeeEntry {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: string;
  tickets: string;
}

const EMPTY_NEW_ENTRY: NewAttendeeEntry = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  source: "tickets",
  tickets: "1"
};

interface UseTicketAttendeeStateArgs {
  attendees: Attendee[];
  setAttendees: React.Dispatch<React.SetStateAction<Attendee[]>>;
  addAttendee: (source: string, row: string[]) => Promise<void>;
  removeAttendee: (attendee: Attendee) => Promise<void>;
  spreadsheetId: string;
}

/**
 * Owns all list-level state and mutation handlers for the ticket
 * attendee table: search/filter, per-field/per-guest optimistic edits,
 * payment status updates, the add-entry form, and the delete flow. Kept
 * separate from TicketAttendeeTab.tsx so that component stays focused
 * on composing/rendering the split-out pieces.
 */
export function useTicketAttendeeState({ attendees, setAttendees, addAttendee, removeAttendee, spreadsheetId }: UseTicketAttendeeStateArgs) {
  const [filterSource, setFilterSource] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [attendeeToDelete, setAttendeeToDelete] = useState<Attendee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [newEntry, setNewEntry] = useState<NewAttendeeEntry>(EMPTY_NEW_ENTRY);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredAttendees = useMemo(() => {
    return attendees.filter(a => {
      const matchesSource = filterSource === "all" || a.sheet === filterSource;
      const searchLow = searchTerm.toLowerCase();
      const matchesSearch =
        a.firstName.toLowerCase().includes(searchLow) ||
        a.lastName.toLowerCase().includes(searchLow) ||
        a.email.toLowerCase().includes(searchLow);
      return matchesSource && matchesSearch;
    });
  }, [attendees, filterSource, searchTerm]);

  const updateField = async (attendee: Attendee, field: string, newValue: string, guestIndex?: number) => {
    if (!spreadsheetId) return;

    let col = 'A';
    if (field === 'lastName') col = 'B';
    if (field === 'email') col = 'C';
    if (field === 'phone') col = 'D';

    if (guestIndex !== undefined && (field === 'firstName' || field === 'lastName' || field === 'email')) {
      // Guest column triples shift after guest 1 on the general "tickets"
      // sheet (an "own bidder number" flag inserted after guest 1 pushes
      // everything past it over by one column) but not on staff/sponsor
      // sheets - the exact same shift attendeeParsing.ts's parser and
      // syncService.ts's collectGuestInfo already account for.
      const GUEST_COLUMNS: Record<string, Record<number, { firstName: string; lastName: string; email: string }>> = {
        tickets: {
          1: { firstName: 'H', lastName: 'I', email: 'J' },
          2: { firstName: 'L', lastName: 'M', email: 'N' },
          3: { firstName: 'P', lastName: 'Q', email: 'R' },
        },
        default: {
          1: { firstName: 'H', lastName: 'I', email: 'J' },
          2: { firstName: 'K', lastName: 'L', email: 'M' },
          3: { firstName: 'N', lastName: 'O', email: 'P' },
        },
      };
      const columnsForGuest = (GUEST_COLUMNS[attendee.sheet] || GUEST_COLUMNS.default)[guestIndex];
      if (columnsForGuest) col = columnsForGuest[field];
    }

    // Just this attendee's previous state, not a whole captured array
    // snapshot - a second attendee edited while this one is still in
    // flight must not be erased by this rollback.
    const previousAttendeeState = attendee;

    // Optimistic update
    setAttendees(prev => prev.map(a => {
      if (a.id !== attendee.id) return a;
      if (guestIndex === undefined) {
        return { ...a, [field]: newValue };
      } else {
        return {
          ...a,
          guestsInfo: a.guestsInfo.map(g => {
            if (g.guestIndex !== guestIndex) return g;
            const updatedGuest = { ...g, [field]: newValue };
            // Keep the combined display name (used by bidderAttendeeInfo.ts's
            // guest-to-bidder matching) in sync with a firstName/lastName edit.
            if (field === 'firstName' || field === 'lastName') {
              updatedGuest.name = `${updatedGuest.firstName} ${updatedGuest.lastName}`.trim();
            }
            return updatedGuest;
          })
        };
      }
    }));

    // Background sync
    updateSheetData(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newValue]])
      .then(() => toast.success("Updated successfully"))
      .catch(e => {
        console.error(e);
        // Rollback
        setAttendees(prev => prev.map(a => a.id === attendee.id ? previousAttendeeState : a));
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      });
  };

  const updatePaymentStatus = async (attendee: Attendee, newStatus: string) => {
    if (!spreadsheetId) return;

    // Just this attendee's previous payment status, not a whole captured
    // array snapshot - a second attendee updated while this one is still
    // in flight must not be erased by this rollback.
    const previousPaymentStatus = attendee.paymentStatus;

    // Optimistic update
    setAttendees(prev => prev.map(a => a.id === attendee.id ? { ...a, paymentStatus: newStatus } : a));

    // Background sync
    const col = attendee.sheet === 'tickets' ? 'U' : 'R'; // Just an estimate, might differ per sheet
    updateSheetData(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newStatus]])
      .then(() => toast.success("Payment status updated"))
      .catch(e => {
        console.error(e);
        // Rollback
        setAttendees(prev => prev.map(a => a.id === attendee.id ? { ...a, paymentStatus: previousPaymentStatus } : a));
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      });
  };

  const handleAddSubmit = async () => {
    if (!newEntry.firstName || !newEntry.lastName) {
      toast.error("Name is required");
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

      if (newEntry.source !== 'tickets') {
        // Column order here matches parseAttendeeRows' own unshifted
        // pm/ps/tp columns (Q/R/S) for staff/sponsor sheets - confirmed
        // against updateAttendeeField's fieldMapping, which independently
        // maps paymentStatus to column R (index 17) for non-"tickets"
        // sheets. Values match the parser's own hardcoded Comp/Paid/$0
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

  const handleDeleteConfirm = async () => {
    if (!attendeeToDelete) return;
    setIsDeleting(true);
    try {
      await removeAttendee(attendeeToDelete);
    } finally {
      setIsDeleting(false);
      setAttendeeToDelete(null);
    }
  };

  return {
    filterSource,
    setFilterSource,
    searchTerm,
    setSearchTerm,
    filteredAttendees,
    updateField,
    updatePaymentStatus,

    isAddDialogOpen,
    setIsAddDialogOpen,
    newEntry,
    setNewEntry,
    handleAddSubmit,
    isSubmitting,

    attendeeToDelete,
    setAttendeeToDelete,
    isDeleting,
    handleDeleteConfirm,
  };
}
