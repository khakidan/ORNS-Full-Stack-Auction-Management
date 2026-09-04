import { Attendee } from "@/types";

/**
 * A guest count that exceeds the tickets purchased is a real data-quality
 * problem (someone marked as buying 1 ticket but bringing 3 guests), not
 * something the app can silently accept as correct. There's currently no
 * in-app path that can *create* this state - guest count only ever comes
 * from the initial ticket-purchase import, and the "Add Entry" dialog
 * doesn't collect guests at all - so this exists purely to flag data that
 * already came in mismatched, per the user's explicit request. If a
 * feature that lets someone add a guest or edit ticketsPurchased is ever
 * built, it should call this first and block the save rather than just
 * warn.
 */
export function hasMoreGuestsThanTicketsPurchased(attendee: Pick<Attendee, "guestsInfo" | "ticketsPurchased">): boolean {
  const ticketsPurchased = parseInt(attendee.ticketsPurchased, 10) || 0;
  return attendee.guestsInfo.length > ticketsPurchased;
}
