import { useState, useCallback } from "react";
import { getSheetData, updateSheetData } from "@/lib/google-api";
import { toast } from "sonner";

export interface Guest {
  name: string;
  email: string;
  guestIndex: number;
  ownBidderNumber: string;
}

export interface Attendee {
  id: string;
  sheet: string;
  rowIndex: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  ticketsPurchased: string;
  hasGuests: string;
  guestsInfo: Guest[];
  paymentMethod: string;
  paymentStatus: string;
  totalPaid: string;
}

export function useAttendees() {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAttendees = useCallback(async (spreadsheetId: string | null) => {
    if (!spreadsheetId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
      const sheetsToFetch = ["tickets", "staff tickets", "sponsor tickets"];
      let allAttendees: Attendee[] = [];
      
      for (const sheetName of sheetsToFetch) {
        try {
          const data = await getSheetData(spreadsheetId, `${sheetName}!A:Z`);
          if (data.values && data.values.length > 1) {
            const rows = data.values.slice(1).map((row: any[], i: number) => {
              const guests: Guest[] = [];
              const isGeneral = sheetName === 'tickets';

              let g1own = '', g2f = row[10], g2l = row[11], g2e = row[12], g2own = '';
              let g3f = row[13], g3l = row[14], g3e = row[15], g3own = '';
              let pm = row[16], ps = row[17], tp = row[18];

              if (isGeneral) {
                g1own = row[10];
                g2f = row[11]; g2l = row[12]; g2e = row[13]; g2own = row[14];
                g3f = row[15]; g3l = row[16]; g3e = row[17]; g3own = row[18];
                pm = row[19]; ps = row[20]; tp = row[21];
              }

              if (row[7] || row[8] || row[9]) guests.push({ name: `${row[7] || ''} ${row[8] || ''}`.trim(), email: row[9]?.toString() || '', guestIndex: 1, ownBidderNumber: g1own?.toString() || '' });
              if (g2f || g2l || g2e) guests.push({ name: `${g2f || ''} ${g2l || ''}`.trim(), email: g2e?.toString() || '', guestIndex: 2, ownBidderNumber: g2own?.toString() || '' });
              if (g3f || g3l || g3e) guests.push({ name: `${g3f || ''} ${g3l || ''}`.trim(), email: g3e?.toString() || '', guestIndex: 3, ownBidderNumber: g3own?.toString() || '' });

              return {
                id: `${sheetName}-${i}`,
                sheet: sheetName,
                rowIndex: i + 2,
                firstName: row[0]?.toString() || "",
                lastName: row[1]?.toString() || "",
                email: row[2]?.toString() || "",
                phone: row[3]?.toString() || "",
                ticketsPurchased: row[4]?.toString() || "0",
                hasGuests: row[5]?.toString() || "",
                guestsInfo: guests,
                paymentMethod: isGeneral ? (pm?.toString() || "") : "Comp",
                paymentStatus: isGeneral ? (ps?.toString() || "") : "Paid",
                totalPaid: isGeneral ? (tp?.toString() || "") : "$0"
              };
            }).filter((a: Attendee) => a.firstName || a.lastName);
            allAttendees = [...allAttendees, ...rows];
          }
        } catch (e) {
          console.error(`Could not fetch ${sheetName}`, e);
        }
      }
      
      setAttendees(allAttendees);
    } catch (e) {
      console.error(e);
      toast.error("Failed to fetch attendees");
    } finally {
      setLoading(false);
    }
  }, []);

  return { attendees, setAttendees, loading, fetchAttendees };
}
