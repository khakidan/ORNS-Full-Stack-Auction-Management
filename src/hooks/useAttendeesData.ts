import { useCallback, useState } from "react";
import { toast } from "sonner";
import { appendSheetData, clearSheetData, getSheetData } from "@/services/google-api";
import { parseAttendeeRows } from "@/lib/attendeeParsing";
import { ROLLBACK_SYNC_ERROR_MESSAGE } from "@/lib/toastMessages";
import { Attendee } from "@/types";

const ATTENDEE_SHEETS = ["tickets", "staff tickets", "sponsor tickets"];

export function useAttendeesData(ticketsSpreadsheetId: string) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAttendees = useCallback(async () => {
    if (!ticketsSpreadsheetId) return;
    setLoading(true);
    try {
      let allAttendees: Attendee[] = [];

      for (const sheetName of ATTENDEE_SHEETS) {
        try {
          const data = await getSheetData(ticketsSpreadsheetId, `${sheetName}!A:Z`);
          if (data.values && data.values.length > 1) {
            allAttendees = [...allAttendees, ...parseAttendeeRows(sheetName, data.values)];
          }
        } catch (e) {
          console.error(`Could not fetch ${sheetName}`, e);
        }
      }

      setAttendees(allAttendees);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [ticketsSpreadsheetId]);

  const addAttendee = async (sheetName: string, rowData: any[]) => {
    if (!ticketsSpreadsheetId) return;

    // Includes a random suffix, not just Date.now(), so two adds
    // triggered in quick succession (same millisecond) don't collide on
    // the same id - a collision would make the scoped rollback below
    // affect both instead of just the one that actually failed.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newAttendee: Attendee = {
      id: tempId,
      sheet: sheetName,
      rowIndex: -1, // Temporary
      firstName: rowData[0]?.toString() || "",
      lastName: rowData[1]?.toString() || "",
      email: rowData[2]?.toString() || "",
      phone: rowData[3]?.toString() || "",
      ticketsPurchased: rowData[4]?.toString() || "0",
      hasGuests: rowData[5]?.toString() || "",
      guestsInfo: [],
      paymentMethod: sheetName === 'tickets' ? (rowData[19]?.toString() || "") : "Comp",
      paymentStatus: sheetName === 'tickets' ? (rowData[20]?.toString() || "") : "Paid",
      totalPaid: sheetName === 'tickets' ? (rowData[21]?.toString() || "") : "$0"
    };

    // 1. Optimistic Update
    setAttendees(prev => [...prev, newAttendee]);

    // 2. Background Sync
    appendSheetData(ticketsSpreadsheetId, `${sheetName}!A:A`, [rowData])
      .then(() => {
        // Re-fetch to get correct IDs/indices from the source of truth
        fetchAttendees();
        toast.success("Attendee record synced successfully");
      })
      .catch((e: any) => {
        // 3. Rollback - scoped to just this newly-added entry, not a
        // captured whole-array snapshot, so another add/remove that
        // succeeded in the meantime isn't wiped out by this failure.
        setAttendees(prev => prev.filter(a => a.id !== tempId));
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      });
  };

  const removeAttendee = async (attendee: Attendee) => {
    if (!ticketsSpreadsheetId) return;

    // 1. Optimistic Update
    setAttendees(prev => prev.filter(a => a.id !== attendee.id));

    // 2. Background Sync
    clearSheetData(ticketsSpreadsheetId, `${attendee.sheet}!A${attendee.rowIndex}:Z${attendee.rowIndex}`)
      .then(() => toast.success("Attendee record cleared in spreadsheet"))
      .catch((e: any) => {
        // 3. Rollback - scoped to just re-adding this one attendee back,
        // not a captured whole-array snapshot, so another add/remove that
        // succeeded in the meantime isn't wiped out by this failure.
        setAttendees(prev => prev.some(a => a.id === attendee.id) ? prev : [...prev, attendee]);
        toast.error(ROLLBACK_SYNC_ERROR_MESSAGE);
      });
  };

  return { attendees, setAttendees, loading, fetchAttendees, addAttendee, removeAttendee };
}
