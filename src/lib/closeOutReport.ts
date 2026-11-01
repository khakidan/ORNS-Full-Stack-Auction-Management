import { AuctionItem, Bidder } from "@/types";
import type { BidGridWin } from "@/lib/bidGridParsing";
import { computeArchiveAttendance } from "@/lib/archiveStats";
import { isStandardItemRow, norm } from "@/lib/standardItems";

/** Where the printable report opens, in its own tab (App.tsx). */
export const CLOSE_OUT_REPORT_PATH = "/CloseOutReport";

/**
 * Who still has to check out - the Dashboard's "Still Need to Check Out"
 * list: present and not checked out, or a proxy bidder who won something
 * (proxies never check in). `winners` maps item ID to winner name.
 */
export function pendingCheckoutBidders(bidders: Bidder[], winners: Record<string, string>): Bidder[] {
  const winningNames = new Set(Object.values(winners));
  return bidders.filter((b) => {
    if (b.checkedOut) return false;
    if (b.checkedIn) return true;
    return b.isProxy && winningNames.has(`${b.firstName} ${b.lastName}`);
  });
}

/** The five categories reported as themselves; every other category is the silent auction. */
const NAMED_SOURCES = ["Live Auction", "Open Appeal", "Raffle Tickets", "Auction Tickets", "Movie Night"] as const;
export const SILENT_AUCTION = "Silent Auction";

/** The bid-grid category a win is reported under in "Where it came from". */
export function sourceOf(category: string | undefined): string {
  const c = norm(category);
  if (c.includes("live")) return "Live Auction";
  return NAMED_SOURCES.find((name) => norm(name) === c) ?? SILENT_AUCTION;
}

/** How a bidder's Payment Method (Bid Management column I) is reported. */
export function paymentMethodLabel(method: string): string {
  const m = norm(method);
  if (m === "cash") return "Cash";
  if (m === "check") return "Check";
  if (m.startsWith("credit card")) return "Card (PayPal)";
  return method.trim() || "Not recorded";
}

/** The 50/50 raffle ticket's standard item (src/lib/standardItems.ts). */
const FIFTY_FIFTY_ITEM_ID = "1504";

export interface CloseOutInput {
  bidders: Bidder[];
  items: AuctionItem[];
  /** The Bid-Management grid's wins (AuctionContext's bidGridWins). */
  wins: BidGridWin[];
  /** Item ID -> winner name (AuctionContext's winners). */
  winners: Record<string, string>;
  /** The Dashboard's Total Raised. */
  totalRaised: number;
  /** Follow-Up sheet rows below the header: bidder ID, item ID or prize name, amount due. */
  followUpRows: string[][];
  /** Special-Winners B2 and B3: the gift card's and the 50/50 raffle's winning bidder numbers. */
  giftCardWinnerId: string;
  raffleWinnerId: string;
}

export interface ReportBidder { id: string; name: string; email: string }
export interface PendingRow extends ReportBidder { paid: boolean; isProxy: boolean; due: number }
export interface FollowUpRow { bidderId: string; name: string; item: string; due: number }
export interface ProxyRow { id: string; name: string; wins: number; checkedOut: boolean }
export interface PrizeWinner { id: string; name: string; checkedOut: boolean }
export interface Amount { name: string; amount: number; count?: number }
export interface TopWin { itemId: string; item: string; bidderId: string; amount: number }

export interface CloseOutReport {
  totalRaised: number;
  totalBidders: number;
  checkedIn: number;
  checkedOut: number;
  itemCount: number;
  attendance: { checkedOut: number; presentNotOut: number; neverIn: number; proxies: number };
  pending: PendingRow[];
  followUps: FollowUpRow[];
  noShows: ReportBidder[];
  proxies: ProxyRow[];
  giftCard: PrizeWinner | null;
  raffle: PrizeWinner | null;
  /** What the 50/50 tickets took in; the winner gets half. */
  raffleGross: number;
  /** All winning bids added up - section 5's total. */
  winsTotal: number;
  collected: number;
  owed: number;
  methods: Amount[];
  sources: Amount[];
  topWins: TopWin[];
  unsold: { id: string; name: string }[];
}

const nameOf = (b: Bidder) => `${b.firstName} ${b.lastName}`.trim();
const money = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const byBidderNumber = (a: { id: string }, b: { id: string }) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);

/**
 * Everything the printable close-out report shows, from what the
 * Dashboard already has. Sections 1-4 match the Dashboard; section 5
 * (money) adds up the same winning bids:
 * - a bidder marked Paid has paid for all their wins except a Follow-Up
 *   row's amount (an item assigned after they had checked out);
 * - everything else is still owed.
 */
export function buildCloseOutReport(input: CloseOutInput): CloseOutReport {
  const { bidders, items, wins, winners, totalRaised, followUpRows } = input;
  const bidderById = new Map(bidders.map((b) => [b.id, b]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const winsByBidder = new Map<string, BidGridWin[]>();
  for (const w of wins) winsByBidder.set(w.bidderId, [...(winsByBidder.get(w.bidderId) ?? []), w]);
  const totalFor = (id: string) => (winsByBidder.get(id) ?? []).reduce((t, w) => t + w.price, 0);

  const followUps: FollowUpRow[] = followUpRows
    .filter((r) => String(r[0] ?? "").trim())
    .map((r) => {
      const bidderId = String(r[0]).trim();
      const itemRef = String(r[1] ?? "").trim();
      const bidder = bidderById.get(bidderId);
      return {
        bidderId,
        name: bidder ? nameOf(bidder) : "Bidder not found",
        item: itemById.get(itemRef)?.name ?? itemRef,
        due: money(r[2]),
      };
    });
  const followUpDue = new Map<string, number>();
  for (const f of followUps) followUpDue.set(f.bidderId, (followUpDue.get(f.bidderId) ?? 0) + f.due);

  const pending: PendingRow[] = pendingCheckoutBidders(bidders, winners).map((b) => ({
    id: b.id, name: nameOf(b), email: b.email, paid: b.paid, isProxy: b.isProxy, due: b.paid ? 0 : totalFor(b.id),
  }));

  const attendance = computeArchiveAttendance(bidders);
  const checkedOut = bidders.filter((b) => b.checkedOut).length;
  const presentNotOut = bidders.filter((b) => b.checkedIn && !b.checkedOut).length;

  const methodTotals = new Map<string, Amount>();
  let collected = 0;
  for (const b of bidders) {
    if (!b.paid) continue;
    const paidFor = Math.max(0, totalFor(b.id) - (followUpDue.get(b.id) ?? 0));
    if (paidFor === 0) continue;
    collected += paidFor;
    const label = paymentMethodLabel(b.paymentMethod ?? "");
    const row = methodTotals.get(label) ?? { name: label, amount: 0, count: 0 };
    row.amount += paidFor;
    row.count! += 1;
    methodTotals.set(label, row);
  }
  const winsTotal = wins.reduce((t, w) => t + w.price, 0);

  const sourceTotals = new Map<string, number>();
  for (const w of wins) {
    const source = sourceOf(itemById.get(w.itemId)?.category);
    sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + w.price);
  }

  const wonIds = new Set([...wins.map((w) => w.itemId), ...Object.keys(winners)]);
  const unsold = items
    .filter((i) => i.id && !wonIds.has(i.id) && !isStandardItemRow(i.id, i.category, i.name))
    .map((i) => ({ id: i.id, name: i.name }))
    .sort(byBidderNumber);

  const prize = (id: string): PrizeWinner | null => {
    const clean = id.trim();
    if (!clean) return null;
    const b = bidderById.get(clean);
    return { id: clean, name: b ? nameOf(b) : "Bidder not found", checkedOut: !!b?.checkedOut };
  };

  return {
    totalRaised,
    totalBidders: bidders.length,
    checkedIn: attendance.checkedIn,
    checkedOut,
    itemCount: items.length,
    attendance: { checkedOut, presentNotOut, neverIn: attendance.noShows.length, proxies: attendance.proxies },
    pending,
    followUps,
    noShows: attendance.noShows.map((b) => ({ id: b.id, name: nameOf(b), email: b.email })),
    proxies: bidders
      .filter((b) => b.isProxy)
      .sort(byBidderNumber)
      .map((b) => ({ id: b.id, name: nameOf(b), wins: winsByBidder.get(b.id)?.length ?? 0, checkedOut: b.checkedOut })),
    giftCard: prize(input.giftCardWinnerId),
    raffle: prize(input.raffleWinnerId),
    raffleGross: wins.filter((w) => w.itemId === FIFTY_FIFTY_ITEM_ID).reduce((t, w) => t + w.price, 0),
    winsTotal,
    collected,
    owed: winsTotal - collected,
    methods: [...methodTotals.values()].sort((a, b) => b.amount - a.amount),
    sources: [...sourceTotals.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    topWins: [...wins]
      .sort((a, b) => b.price - a.price)
      .slice(0, 5)
      .map((w) => ({ itemId: w.itemId, item: itemById.get(w.itemId)?.name ?? `Item ${w.itemId}`, bidderId: w.bidderId, amount: w.price })),
    unsold,
  };
}
