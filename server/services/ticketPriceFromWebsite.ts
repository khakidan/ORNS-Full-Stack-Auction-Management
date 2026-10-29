import { FluentFormsApi, FluentFormsEntry, fluentFormsApiFromEnv, purchaseFromEntry } from "./fluentFormsApi";
import { getSharedConfig, updateSharedConfigFields } from "./configService";
import { readTicketPollStatus } from "./ticketPoll";

/**
 * The ticket price comes from the website's "Auction Tickets" form, so the
 * walk-in price in Settings can't drift from what website buyers paid.
 *
 * The form prices tickets as a list of choices - "1", "2", "4", ... - each
 * with its own total, set in the form's payment field. The app's WordPress
 * user can't open the form's definition (that needs Fluent Forms' "manage
 * forms" permission, which can also edit it), but every entry records the
 * total it was charged. So the price is each of this season's entries'
 * total divided by its tickets. They have to agree: a coupon, or a price
 * changed mid-season, leaves Settings as it is for staff to check.
 *
 * Run by Set Up Bid Management App only - by then ticket sales are open,
 * and the price won't change again this year.
 */
export type WebsiteTicketPrice =
  | { outcome: "updated"; price: string; previous: string }
  | { outcome: "unchanged"; price: string }
  /** No purchase this season yet - Settings is left as it is. */
  | { outcome: "no-purchases" }
  /** This season's entries were charged different prices per ticket. */
  | { outcome: "disagree"; prices: string[] }
  /** The Fluent Forms API isn't set up, or couldn't be read. */
  | { outcome: "unavailable"; reason: string };

const asPrice = (dollars: number): string => String(Math.round(dollars * 100) / 100);

/** Each entry's price per ticket, skipping spam and any entry without tickets or a total. */
export function pricesPerTicket(entries: FluentFormsEntry[]): string[] {
  const prices: string[] = [];
  for (const entry of entries) {
    if (entry.status === "spam" || !(entry.total > 0)) continue;
    const purchase = purchaseFromEntry(entry);
    if ("error" in purchase || !Number.isInteger(purchase.tickets) || purchase.tickets < 1) continue;
    prices.push(asPrice(entry.total / purchase.tickets));
  }
  return prices;
}

/** What this season's entries say the price is; reads only WordPress. */
export async function readWebsiteTicketPrice(
  fluentForms: Pick<FluentFormsApi, "listEntriesAfter">,
  seasonStartEntryId: number
): Promise<{ price: string } | { outcome: "no-purchases" } | { outcome: "disagree"; prices: string[] }> {
  const prices = pricesPerTicket(await fluentForms.listEntriesAfter(seasonStartEntryId));
  const distinct = [...new Set(prices)];
  if (distinct.length === 0) return { outcome: "no-purchases" };
  if (distinct.length > 1) return { outcome: "disagree", prices: distinct.sort((a, b) => Number(a) - Number(b)) };
  return { price: distinct[0] };
}

/**
 * Sets Settings' ticket price to the website's, and marks it as coming
 * from there (Settings then shows it read-only). Never throws - Set Up
 * goes on whatever happens here.
 */
export async function syncTicketPriceFromWebsite(updatedBy: string, now = new Date()): Promise<WebsiteTicketPrice> {
  try {
    const fluentForms = fluentFormsApiFromEnv();
    if (!fluentForms) return { outcome: "unavailable", reason: "the website's Fluent Forms API isn't set up" };
    const poll = await readTicketPollStatus();
    if (!poll) return { outcome: "unavailable", reason: "the website ticket check hasn't started this season" };

    const found = await readWebsiteTicketPrice(fluentForms, poll.seasonStartEntryId);
    if (!("price" in found)) return found;

    const config = await getSharedConfig();
    const previous = config.ticketPrice;
    await updateSharedConfigFields({ ticketPrice: found.price, ticketPriceFromWebsiteAt: now.toISOString() }, updatedBy);
    return Number(previous) === Number(found.price) ? { outcome: "unchanged", price: found.price } : { outcome: "updated", price: found.price, previous };
  } catch (error: any) {
    console.warn("[TicketPrice] Couldn't read the ticket price from the website:", error?.message || error);
    return { outcome: "unavailable", reason: "the website couldn't be read" };
  }
}

/** One line for Set Up's message. */
export function describeWebsiteTicketPrice(result: WebsiteTicketPrice): string {
  switch (result.outcome) {
    case "updated":
      return `Ticket price changed from $${result.previous} to $${result.price} to match the website.`;
    case "unchanged":
      return `Ticket price matches the website ($${result.price}).`;
    case "no-purchases":
      return "No website ticket purchases yet this season, so the ticket price in Settings was left as it is.";
    case "disagree":
      return `Website purchases this season were charged different prices per ticket ($${result.prices.join(", $")}), so the ticket price in Settings was left as it is - check it.`;
    case "unavailable":
      return `Couldn't check the ticket price against the website (${result.reason}); the price in Settings was left as it is.`;
  }
}
