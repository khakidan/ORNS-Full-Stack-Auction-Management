import { guestRowIndicesForSheet } from "../../src/lib/attendeeSheetColumns";

/** Rows as the Sheets API returns them (cells may be strings, numbers, booleans or missing). */
export type SheetRows = unknown[][];

/**
 * Someone on the Auction Tickets spreadsheet who gets a bidder number,
 * with `ref` saying where: "tickets!12", "staff tickets!4", or
 * "tickets!12#2" for guest 2 on row 12. Bidder-Numbers column O keeps that
 * ref, so a bidder stays tied to their ticket when the name or email on
 * it changes (bidderTicketSync.ts).
 */
export interface TicketPerson {
  ref: string;
  firstName: string;
  lastName: string;
  email: string;
}

const cell = (row: unknown[] | undefined, index: number): string => String(row?.[index] ?? "").trim();

/**
 * How a ticket name is written on the bidder. Each word typed in all
 * capitals or all lowercase is tidied ("MOORE" -> "Moore", "amy & chris"
 * -> "Amy & Chris"); a word with its own mix of cases is kept as typed
 * ("McDonald", "Amy/Chris"). The one rule for Set Up, walk-ins and the
 * ticket sync, so a bidder's name always follows from their ticket's.
 */
export function bidderName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .map((word) => {
      const letters = word.replace(/[^\p{L}]/gu, "");
      if (!letters) return word;
      const uniform = letters === letters.toUpperCase() || letters === letters.toLowerCase();
      if (!uniform) return word;
      const lower = word.toLowerCase();
      return lower.replace(/\p{L}/u, (c) => c.toUpperCase());
    })
    .join(" ");
}

/** How a bidder's email is written: trimmed and lowercased. */
export function bidderEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Everyone who gets a bidder number, in bidder-number order: staff, then
 * every ticket buyer, then every guest 1 who asked for their own number,
 * then guest 2, then guest 3, then sponsors. Set Up numbers bidders in
 * this order (syncService.ts), so it is load-bearing.
 */
export function collectTicketPeople(staffRows: SheetRows, ticketsRows: SheetRows, sponsorRows: SheetRows): TicketPerson[] {
  const people: TicketPerson[] = [];

  // Staff, ticket buyers and sponsors all start [First, Last, Email].
  const collectPeople = (sheet: string, rows: SheetRows) => {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[] | undefined;
      if (row && (cell(row, 0) || cell(row, 1))) {
        people.push({ ref: `${sheet}!${i + 1}`, firstName: cell(row, 0), lastName: cell(row, 1), email: cell(row, 2) });
      }
    }
  };

  // Guests who asked for their own bidder number. A guest is real whenever
  // their own name is present - matches src/lib/attendeeParsing.ts, which
  // never reads the separate guest-marker checkbox.
  const collectGuests = (guestIndex: 1 | 2 | 3) => {
    const cols = guestRowIndicesForSheet("tickets")[guestIndex];
    const ownBidderCol = cols.ownBidderNumber!;
    for (let i = 1; i < ticketsRows.length; i++) {
      const row = ticketsRows[i] as unknown[] | undefined;
      if (!row || row.length <= ownBidderCol) continue;
      const first = cell(row, cols.firstName);
      if (first !== "" && cell(row, ownBidderCol).toLowerCase() === "yes") {
        people.push({ ref: `tickets!${i + 1}#${guestIndex}`, firstName: first, lastName: cell(row, cols.lastName), email: cell(row, cols.email) });
      }
    }
  };

  collectPeople("staff tickets", staffRows);
  collectPeople("tickets", ticketsRows);
  collectGuests(1);
  collectGuests(2);
  collectGuests(3);
  collectPeople("sponsor tickets", sponsorRows);
  return people;
}
