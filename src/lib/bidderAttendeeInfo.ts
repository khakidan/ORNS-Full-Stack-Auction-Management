import { Bidder, Attendee } from "@/types";
import { parseTicketRef } from "@/lib/ticketRef";

export interface BidderAttendeeInfo {
  attendee: Attendee | undefined;
  isGuest: boolean;
}

/**
 * Matches a Bidder to their ticket-purchase Attendee record: by the ticket
 * Bidder-Numbers column O ties them to (so a renamed ticket still
 * matches), else as the primary ticket holder (name match) or as a named
 * guest of another attendee's ticket purchase.
 */
export function getBidderAttendeeInfo(bidder: Bidder, attendees: Attendee[]): BidderAttendeeInfo {
  const ref = parseTicketRef(bidder.ticketRef);
  if (ref) {
    const ticket = attendees.find(a => a.sheet === ref.sheet && a.rowIndex === ref.row);
    if (ticket) return { attendee: ticket, isGuest: ref.guest > 0 };
  }

  const primary = attendees.find(a =>
    a.firstName.trim().toLowerCase() === bidder.firstName.trim().toLowerCase() &&
    a.lastName.trim().toLowerCase() === bidder.lastName.trim().toLowerCase()
  );

  if (primary) return { attendee: primary, isGuest: false };

  // Guest.ownBidderNumber never actually holds a bidder ID - it's the
  // sheet's "yes"/"no" opt-in flag (see attendeeParsing.ts/syncService.ts),
  // so a `=== bidder.id` comparison against it could never match. Email is
  // a far more reliable signal than the freeform name fallback (which
  // stays, for guests without an email on file).
  const bidderEmail = bidder.email?.trim().toLowerCase();
  const bidderFullName = `${bidder.firstName} ${bidder.lastName}`.trim().toLowerCase();

  const guestOf = attendees.find(a =>
    a.guestsInfo.some(g =>
      (!!bidderEmail && !!g.email && g.email.trim().toLowerCase() === bidderEmail) ||
      (!!g.name && g.name.toLowerCase() === bidderFullName)
    )
  );

  if (guestOf) return { attendee: guestOf, isGuest: true };

  return { attendee: undefined, isGuest: false };
}
