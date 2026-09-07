import { Attendee } from "@/types";

/**
 * A guest count that exceeds the tickets purchased is a real data-quality
 * problem (someone marked as buying 1 ticket but bringing 3 guests), not
 * something the app can silently accept as correct. Originally added
 * purely to flag data that came in mismatched from the ticket-purchase
 * import (no in-app path could create this state yet); AddAttendeeDialog.tsx
 * and EditAttendeeDialog.tsx (see the "Attendee Tickets workflow
 * challenges" bug report) now both call this on every guest/ticketsPurchased
 * change and disable Save while it's true, exactly as this docblock used
 * to ask a future feature to do.
 */
export function hasMoreGuestsThanTicketsPurchased(attendee: Pick<Attendee, "guestsInfo" | "ticketsPurchased">): boolean {
  const ticketsPurchased = parseInt(attendee.ticketsPurchased, 10) || 0;
  return attendee.guestsInfo.length > ticketsPurchased;
}
