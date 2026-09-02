import { Attendee, Guest } from "@/types";

/**
 * Parses raw rows from one ticket-purchase sheet ("tickets",
 * "staff tickets", or "sponsor tickets") into Attendee objects. The
 * general "tickets" sheet has extra leading columns (an "own bidder
 * number" flag on the first guest) that shift every subsequent guest
 * and payment column by one versus the staff/sponsor sheets - both
 * layouts are handled here.
 */
export function parseAttendeeRows(sheetName: string, values: string[][]): Attendee[] {
  const isGeneral = sheetName === 'tickets';

  return values
    .slice(1)
    .map((row: string[], i: number): Attendee => {
      const guests: Guest[] = [];

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
    })
    .filter((a: Attendee) => a.firstName || a.lastName);
}
