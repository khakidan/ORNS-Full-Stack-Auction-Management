/**
 * Where a bidder's ticket is, as Bidder-Numbers column O keeps it:
 * "tickets!12", "staff tickets!4", or "tickets!12#2" for guest 2 on row
 * 12 (server/services/ticketPeople.ts writes these). Shared by the server
 * and the Bidders page.
 */
export interface TicketRef {
  sheet: string;
  row: number;
  /** 0 for the ticket holder, 1-3 for a guest. */
  guest: number;
}

export function parseTicketRef(ref: string | undefined): TicketRef | null {
  const m = /^(.+)!(\d+)(?:#([123]))?$/.exec((ref || "").trim());
  return m ? { sheet: m[1], row: Number(m[2]), guest: m[3] ? Number(m[3]) : 0 } : null;
}
