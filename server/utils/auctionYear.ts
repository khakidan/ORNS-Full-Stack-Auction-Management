/**
 * The year of the auction the app is currently working toward. The
 * auction is held in March/April, so from May on the "current" auction is
 * next year's (getMonth() is 0-indexed: > 3 means May or later). Shared by
 * the new-year rollover and the Archived Auctions lookup so they can never
 * disagree about which folders are "last year" and "the year before".
 */
export function currentAuctionYear(now: Date = new Date()): number {
  return now.getFullYear() + (now.getMonth() > 3 ? 1 : 0);
}
