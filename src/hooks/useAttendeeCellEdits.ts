import { toast } from "sonner";
import { updateAttendeeCells } from "@/services/google-api";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { guestColumnsForSheet, paymentColumnsForSheet, GuestSlotIndex } from "@/lib/attendeeSheetColumns";
import { GuestDraft } from "@/components/AttendeeGuestsEditor";
import { Attendee, Guest } from "@/types";

/**
 * The Attendee List's cell edits: one field, the payment status, or a
 * whole guest slot added or cleared. Each updates the list at once and
 * writes in the background, putting back only that attendee's previous
 * state if the write fails. Split out of useTicketAttendeeState.ts.
 */
export function useAttendeeCellEdits(
  spreadsheetId: string,
  setAttendees: React.Dispatch<React.SetStateAction<Attendee[]>>
) {
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

  return { updateField, updatePaymentStatus, addGuestSlot, removeGuestSlot };
}
