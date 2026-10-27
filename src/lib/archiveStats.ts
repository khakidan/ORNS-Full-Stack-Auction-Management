import { Bidder } from "@/types";

export interface ArchiveAttendance {
  registered: number;
  checkedIn: number;
  proxies: number;
  /** Registered, not checked in, and not a proxy bidder - paid for a ticket (or were added) but never showed. */
  noShows: Bidder[];
  /** noShows as a percent of the bidders who were expected in person (registered minus proxies), 0 when none. */
  noShowPercent: number;
}

/**
 * Attendance numbers for a past auction. A proxy bidder bids without
 * attending, so - exactly like the live Dashboard's "unattended" list
 * (useDashboardState.ts) - they are neither a no-show nor counted in the
 * percentage's denominator.
 */
export function computeArchiveAttendance(bidders: Bidder[]): ArchiveAttendance {
  const proxies = bidders.filter((b) => b.isProxy).length;
  const noShows = bidders
    .filter((b) => !b.checkedIn && !b.isProxy)
    .sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
  const expectedInPerson = bidders.length - proxies;
  return {
    registered: bidders.length,
    checkedIn: bidders.filter((b) => b.checkedIn).length,
    proxies,
    noShows,
    noShowPercent: expectedInPerson > 0 ? Math.round((noShows.length / expectedInPerson) * 100) : 0,
  };
}
