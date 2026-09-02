import { useMemo, useState } from "react";
import { toast } from "sonner";
import { updateSheetData } from "@/services/google-api";
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
    if (field === 'email') {
      col = 'C';
      if (attendee.sheet === 'tickets') {
        if (guestIndex === 1) col = 'J';
        else if (guestIndex === 2) col = 'N';
        else if (guestIndex === 3) col = 'R';
      } else {
        if (guestIndex === 1) col = 'J';
        else if (guestIndex === 2) col = 'M';
        else if (guestIndex === 3) col = 'P';
      }
    }
    if (field === 'phone') col = 'D';

    const previousAttendees = [...attendees];

    // Optimistic update
    setAttendees(prev => prev.map(a => {
      if (a.id !== attendee.id) return a;
      if (guestIndex === undefined) {
        return { ...a, [field]: newValue };
      } else {
        return {
          ...a,
          guestsInfo: a.guestsInfo.map(g => g.guestIndex === guestIndex ? { ...g, email: newValue } : g)
        };
      }
    }));

    // Background sync
    updateSheetData(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newValue]])
      .then(() => toast.success("Updated successfully"))
      .catch(e => {
        console.error(e);
        // Rollback
        setAttendees(previousAttendees);
        toast.error("Failed to sync updates—rolling back...");
      });
  };

  const updatePaymentStatus = async (attendee: Attendee, newStatus: string) => {
    if (!spreadsheetId) return;

    const previousAttendees = [...attendees];

    // Optimistic update
    setAttendees(prev => prev.map(a => a.id === attendee.id ? { ...a, paymentStatus: newStatus } : a));

    // Background sync
    const col = attendee.sheet === 'tickets' ? 'U' : 'R'; // Just an estimate, might differ per sheet
    updateSheetData(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newStatus]])
      .then(() => toast.success("Payment status updated"))
      .catch(e => {
        console.error(e);
        // Rollback
        setAttendees(previousAttendees);
        toast.error("Failed to sync updates—rolling back...");
      });
  };

  const handleAddSubmit = async () => {
    if (!newEntry.firstName || !newEntry.lastName) {
      toast.error("Name is required");
      return;
    }

    const row = new Array(25).fill("");
    row[0] = newEntry.firstName;
    row[1] = newEntry.lastName;
    row[2] = newEntry.email;
    row[3] = newEntry.phone;
    row[4] = newEntry.tickets;

    if (newEntry.source !== 'tickets') {
      row[16] = "Paid"; // Payment Status
      row[17] = "$0";   // Total Paid
    } else {
      row[19] = "Manual";
      row[20] = "Pending";
      row[21] = "$0";
    }

    await addAttendee(newEntry.source, row);
    setIsAddDialogOpen(false);
    setNewEntry(EMPTY_NEW_ENTRY);
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

    attendeeToDelete,
    setAttendeeToDelete,
    isDeleting,
    handleDeleteConfirm,
  };
}
