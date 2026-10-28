import { useMemo, useState } from "react";
import { AttendeeEditDraft } from "@/components/EditAttendeeDialog";
import { Attendee } from "@/types";
import { useAttendeeCellEdits } from "./useAttendeeCellEdits";
import { useAddAttendeeForm } from "./useAddAttendeeForm";

interface UseTicketAttendeeStateArgs {
  attendees: Attendee[];
  setAttendees: React.Dispatch<React.SetStateAction<Attendee[]>>;
  addAttendee: (source: string, row: string[]) => Promise<void>;
  removeAttendee: (attendee: Attendee) => Promise<void>;
  spreadsheetId: string;
}

/**
 * Owns all list-level state and mutation handlers for the ticket
 * attendee table: search/filter, the edit dialog's save, and the delete
 * flow - composing the cell edits (useAttendeeCellEdits.ts) and the add
 * form (useAddAttendeeForm.ts). Kept separate from TicketAttendeeTab.tsx
 * so that component stays focused on composing/rendering the split-out
 * pieces.
 */
export function useTicketAttendeeState({ attendees, setAttendees, addAttendee, removeAttendee, spreadsheetId }: UseTicketAttendeeStateArgs) {
  const [filterSource, setFilterSource] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [attendeeToDelete, setAttendeeToDelete] = useState<Attendee | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [attendeeToEdit, setAttendeeToEdit] = useState<Attendee | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const { updateField, updatePaymentStatus, addGuestSlot, removeGuestSlot } = useAttendeeCellEdits(spreadsheetId, setAttendees);
  const addForm = useAddAttendeeForm(addAttendee);

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

    ...addForm,

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
