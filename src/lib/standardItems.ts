/**
 * The item a ticket sale is recorded against in the bid grid - a walk-in's
 * ticket (server/services/bidderService.ts) - and the Auction Tickets
 * standard item's ID. Its own category base, 1701.
 */
export const AUCTION_TICKETS_ITEM_ID = "1701";

/**
 * The items every auction sells at a fixed price, whoever donated what:
 * Movie Night, raffle tickets, the Open Appeal tiers and the Auction
 * Tickets item a walk-in's ticket is recorded against
 * (AUCTION_TICKETS_ITEM_ID). Each is sold to as many people as want one,
 * and only an Administrator may change one. Shared by the server
 * (server/services/standardItems.ts keeps them on the Auction Items list)
 * and the Auction Items page. The price goes in Value; the Auction
 * Tickets price is the Config's ticket price.
 */
export interface StandardItem {
  id: string;
  category: string;
  name: string;
  /** null: the Config's ticket price. */
  price: string | null;
}

export const STANDARD_ITEMS: StandardItem[] = [
  { id: "1401", category: "Movie Night", name: "A Night with the ORNS Staff", price: "30" },
  { id: "1501", category: "Raffle Tickets", name: "One Raffle Ticket for a $500 Amazon Gift Card", price: "5" },
  { id: "1502", category: "Raffle Tickets", name: "Five Raffle Tickets for a $500 Amazon Gift Card", price: "15" },
  { id: "1503", category: "Raffle Tickets", name: "Ten Raffle Tickets for a $500 Amazon Gift Card", price: "30" },
  { id: "1504", category: "Raffle Tickets", name: "One 50/50 Raffle Ticket", price: "20" },
  { id: "1601", category: "Open Appeal", name: "Open Appeal for $500", price: "500" },
  { id: "1602", category: "Open Appeal", name: "Open Appeal for $250", price: "250" },
  { id: "1603", category: "Open Appeal", name: "Open Appeal for $100", price: "100" },
  { id: "1604", category: "Open Appeal", name: "Open Appeal for $50", price: "50" },
  { id: "1605", category: "Open Appeal", name: "Open Appeal for $25", price: "25" },
  // The price is the Config's ticket price.
  { id: AUCTION_TICKETS_ITEM_ID, category: "Auction Tickets", name: "Auction Tickets", price: null },
];

/** Names that mean the same standard item: an earlier season's wording. */
export const FORMER_NAMES: Record<string, string[]> = {
  "1504": ["One 50/50 Raffle Ticket $20"],
};

export const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
export const namesOf = (item: StandardItem) => [item.name, ...(FORMER_NAMES[item.id] ?? [])].map(norm);
const ALL_STANDARD_NAMES = new Set(STANDARD_ITEMS.flatMap(namesOf));

/**
 * Whether `name` is one of the standard items - each sold to as many
 * people as want one, whatever the sheet's Allow Multiple Winners says
 * (isRepeatableItem, winningBidChecks.ts).
 */
export function isStandardItemName(name: unknown): boolean {
  return ALL_STANDARD_NAMES.has(norm(name));
}

/**
 * Whether an Auction-Items row is a standard item: its name is one (or a
 * former one), or it has a standard item's ID and category - an
 * Administrator may have renamed it.
 */
export function isStandardItemRow(id: unknown, category: unknown, name: unknown): boolean {
  if (isStandardItemName(name)) return true;
  return STANDARD_ITEMS.some((item) => item.id === String(id ?? "").trim() && norm(item.category) === norm(category));
}
