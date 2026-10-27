import { useMemo, useState } from "react";
import { toast } from "sonner";
import { updateAttendeeCells } from "@/services/google-api";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { hasMoreGuestsThanTicketsPurchased } from "@/lib/attendeeValidation";
import { guestColumnsForSheet, guestRowIndicesForSheet, paymentColumnsForSheet, GuestSlotIndex } from "@/lib/attendeeSheetColumns";
import { NewAttendeeEntry } from "@/components/AddAttendeeDialog";
import { AttendeeEditDraft } from "@/components/EditAttendeeDialog";
import { GuestDraft } from "@/components/AttendeeGuestsEditor";
import { Attendee, Guest } from "@/types";

const EMPTY_NEW_ENTRY: NewAttendeeEntry = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  source: "tickets",
  tickets: "1",
  guests: [],
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
  const [attendeeToEdit, setAttendeeToEdit] = useState<Attendee | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
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
    if (field === 'ticketsPurchased') col = 'E';
    if (field === 'hasGuests') col = 'F';
    if (field === 'paymentMethod' || field === 'totalPaid') {
      col = paymentColumnsForSheet(attendee.sheet)[field];
    }

    if (guestIndex !== undefined && (field === 'firstName' || field === 'lastName' || field === 'email' || field === 'ownBidderNumber')) {
      // Guest column triples shift after guest 1 on the general "tickets"
      // sheet (an "own bidder number" flag inserted after guest 1 pushes
      // everything past it over by one column) but not on staff/sponsor
      // sheets - the exact same shift attendeeParsing.ts's parser and
      // syncService.ts's collectGuestInfo already account for.
      const columnsForGuest = guestColumnsForSheet(attendee.sheet)[guestIndex as GuestSlotIndex];
      const resolvedCol = columnsForGuest?.[field as 'firstName' | 'lastName' | 'email' | 'ownBidderNumber'];
      if (resolvedCol) col = resolvedCol;
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
    updateAttendeeCells(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newValue]])
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
    const col = paymentColumnsForSheet(attendee.sheet).paymentStatus;
    updateAttendeeCells(spreadsheetId, `${attendee.sheet}!${col}${attendee.rowIndex}`, [[newStatus]])
      .then(() => toast.success("Payment status updated"))
      .catch(e => {
        console.error(e);
        // Rollback
        setAttendees(prev => prev.map(a => a.id === attendee.id ? { ...a, paymentStatus: previousPaymentStatus } : a));
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      });
  };

  /**
   * Adds a brand-new guest slot - writes the whole 3-4 column range for
   * that slot in one call (rather than per-field, like an existing
   * guest's edits reuse updateField for) since there's no prior guest
   * object for the optimistic update to find/merge into.
   */
  const addGuestSlot = async (attendee: Attendee, guest: GuestDraft) => {
    if (!spreadsheetId) return;
    const cols = guestColumnsForSheet(attendee.sheet)[guest.guestIndex];

    const previousAttendeeState = attendee;
    const newGuest: Guest = {
      name: `${guest.firstName} ${guest.lastName}`.trim(),
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
      guestIndex: guest.guestIndex,
      ownBidderNumber: cols.ownBidderNumber ? guest.ownBidderNumber : "",
    };

    setAttendees(prev => prev.map(a => a.id === attendee.id
      ? { ...a, guestsInfo: [...a.guestsInfo, newGuest].sort((x, y) => x.guestIndex - y.guestIndex) }
      : a));

    const values = [guest.firstName, guest.lastName, guest.email];
    const lastCol = cols.ownBidderNumber || cols.email;
    if (cols.ownBidderNumber) values.push(guest.ownBidderNumber);

    updateAttendeeCells(spreadsheetId, `${attendee.sheet}!${cols.firstName}${attendee.rowIndex}:${lastCol}${attendee.rowIndex}`, [values])
      .then(() => toast.success("Guest added successfully"))
      .catch(e => {
        console.error(e);
        setAttendees(prev => prev.map(a => a.id === attendee.id ? previousAttendeeState : a));
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      });
  };

  /** Clears a removed guest's whole column range in one call - the mirror of addGuestSlot. */
  const removeGuestSlot = async (attendee: Attendee, guest: Guest) => {
    if (!spreadsheetId) return;
    const cols = guestColumnsForSheet(attendee.sheet)[guest.guestIndex as GuestSlotIndex];

    const previousAttendeeState = attendee;
    setAttendees(prev => prev.map(a => a.id === attendee.id
      ? { ...a, guestsInfo: a.guestsInfo.filter(g => g.guestIndex !== guest.guestIndex) }
      : a));

    const values = ["", "", ""];
    const lastCol = cols.ownBidderNumber || cols.email;
    if (cols.ownBidderNumber) values.push("");

    updateAttendeeCells(spreadsheetId, `${attendee.sheet}!${cols.firstName}${attendee.rowIndex}:${lastCol}${attendee.rowIndex}`, [values])
      .then(() => toast.success("Guest removed"))
      .catch(e => {
        console.error(e);
        setAttendees(prev => prev.map(a => a.id === attendee.id ? previousAttendeeState : a));
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      });
  };

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

  /**
   * Saves everything EditAttendeeDialog.tsx collected in one action,
   * reusing updateField/updatePaymentStatus's already-tested per-cell
   * sync + rollback for each field that actually changed - only a diff
   * against the attendee being edited, not a full rewrite, keeps this
   * from re-syncing (and re-rollback-racing) fields the user never
   * touched. Guest slots are reconciled against all 3 fixed positions
   * (not just what's in the draft) so a removed guest is actually
   * cleared on the sheet, not merely skipped.
   */
  const handleEditSave = async (draft: AttendeeEditDraft) => {
    if (!attendeeToEdit) return;
    const attendee = attendeeToEdit;

    const fieldUpdates: Promise<void>[] = [];
    (["firstName", "lastName", "email", "phone", "ticketsPurchased", "paymentMethod", "totalPaid"] as const).forEach((field) => {
      if (draft[field] !== attendee[field]) {
        fieldUpdates.push(updateField(attendee, field, draft[field]));
      }
    });

    for (const guestIndex of [1, 2, 3] as const) {
      const original = attendee.guestsInfo.find((g) => g.guestIndex === guestIndex) || null;
      const current = draft.guests.find((g) => g.guestIndex === guestIndex) || null;

      if (!original && current) {
        fieldUpdates.push(addGuestSlot(attendee, current));
        continue;
      }
      if (original && !current) {
        fieldUpdates.push(removeGuestSlot(attendee, original));
        continue;
      }
      if (original && current) {
        (["firstName", "lastName", "email", "ownBidderNumber"] as const).forEach((field) => {
          if (field === "ownBidderNumber" && attendee.sheet !== "tickets") return;
          if (current[field] !== original[field]) {
            fieldUpdates.push(updateField(attendee, field, current[field], guestIndex));
          }
        });
      }
    }

    // Only re-derive hasGuests when this save actually changes the guest
    // count (added/removed a slot above) - comparing against the stored
    // hasGuests flag directly could otherwise "fix" a pre-existing,
    // unrelated mismatch as a side effect of an unrelated field edit.
    if (draft.guests.length !== attendee.guestsInfo.length) {
      fieldUpdates.push(updateField(attendee, "hasGuests", draft.guests.length > 0 ? "yes" : ""));
    }

    if (draft.paymentStatus !== attendee.paymentStatus) {
      fieldUpdates.push(updatePaymentStatus(attendee, draft.paymentStatus));
    }

    if (fieldUpdates.length === 0) {
      setAttendeeToEdit(null);
      return;
    }

    setIsSavingEdit(true);
    try {
      await Promise.all(fieldUpdates);
    } finally {
      setIsSavingEdit(false);
      setAttendeeToEdit(null);
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

    attendeeToEdit,
    setAttendeeToEdit,
    isSavingEdit,
    handleEditSave,
  };
}
