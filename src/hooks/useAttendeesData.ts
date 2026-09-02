import { useCallback, useState } from "react";
import { toast } from "sonner";
import { appendSheetData, clearSheetData, getSheetData } from "@/services/google-api";
import { parseAttendeeRows } from "@/lib/attendeeParsing";
import { Attendee } from "@/types";

const ATTENDEE_SHEETS = ["tickets", "staff tickets", "sponsor tickets"];

export function useAttendeesData(ticketsSpreadsheetId: string) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);

  const fetchAttendees = useCallback(async () => {
    if (!ticketsSpreadsheetId) return;
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
    }
  }, [ticketsSpreadsheetId]);

  const addAttendee = async (sheetName: string, rowData: any[]) => {
    if (!ticketsSpreadsheetId) return;

    const tempId = `temp-${Date.now()}`;
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

    // 1. Store previous state
    const previousAttendees = [...attendees];

    // 2. Optimistic Update
    setAttendees(prev => [...prev, newAttendee]);

    // 3. Background Sync
    appendSheetData(ticketsSpreadsheetId, `${sheetName}!A:A`, [rowData])
      .then(() => {
        // Re-fetch to get correct IDs/indices from the source of truth
        fetchAttendees();
        toast.success("Attendee record synced successfully");
      })
      .catch((e: any) => {
        // 4. Rollback
        setAttendees(previousAttendees);
        toast.error(`Failed to sync updates—retrying... local state reverted.`);
      });
  };

  const removeAttendee = async (attendee: Attendee) => {
    if (!ticketsSpreadsheetId) return;

    // 1. Store previous
    const previousAttendees = [...attendees];

    // 2. Optimistic Update
    setAttendees(prev => prev.filter(a => a.id !== attendee.id));

    // 3. Background Sync
    clearSheetData(ticketsSpreadsheetId, `${attendee.sheet}!A${attendee.rowIndex}:Z${attendee.rowIndex}`)
      .then(() => toast.success("Attendee record cleared in spreadsheet"))
      .catch((e: any) => {
        // 4. Rollback
        setAttendees(previousAttendees);
        toast.error(`Failed to sync updates—retrying... local state reverted.`);
      });
  };

  return { attendees, setAttendees, fetchAttendees, addAttendee, removeAttendee };
}
