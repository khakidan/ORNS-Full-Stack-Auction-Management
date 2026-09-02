import { Bidder, Attendee } from "@/types";

export interface BidderAttendeeInfo {
  attendee: Attendee | undefined;
  isGuest: boolean;
}

/**
 * Matches a Bidder to their ticket-purchase Attendee record, either as
 * the primary ticket holder (name match) or as a named guest of another
 * attendee's ticket purchase.
 */
export function getBidderAttendeeInfo(bidder: Bidder, attendees: Attendee[]): BidderAttendeeInfo {
  const primary = attendees.find(a =>
    a.firstName.trim().toLowerCase() === bidder.firstName.trim().toLowerCase() &&
    a.lastName.trim().toLowerCase() === bidder.lastName.trim().toLowerCase()
  );

  if (primary) return { attendee: primary, isGuest: false };

  const guestOf = attendees.find(a =>
    a.guestsInfo.some(g =>
      g.ownBidderNumber === bidder.id ||
      (g.name && g.name.toLowerCase() === `${bidder.firstName} ${bidder.lastName}`.trim().toLowerCase())
    )
  );

  if (guestOf) return { attendee: guestOf, isGuest: true };

  return { attendee: undefined, isGuest: false };
}
