import { useRef, useState } from "react";
import { toast } from "sonner";
import { AuctionItem, Bidder } from "@/types";

export interface QuickEntryFeedRow {
  id: string;
  itemId: string;
  itemName: string;
  bidderId: string;
  bidderName: string;
  price: number;
  timestamp: number;
  outcome: "recorded" | "blocked-duplicate";
  /** The bid's idempotency key - the feed looks it up in the outbox to show "saved on this device". */
  idempotencyKey?: string;
}

interface UseQuickBidEntryStateArgs {
  items: AuctionItem[];
  bidders: Bidder[];
  winners: Record<string, string>;
  recordWinningBid: (bidderId: string, itemId: string, price: number) => Promise<string | void>;
}

/**
 * State and submit logic for the Bid Entry redesign's "Quick Entry" mode:
 * one record at a time, Enter-to-advance between fields, auto-refocus on
 * the Item Number field after a successful submit, and an in-memory
 * "This Session" feed of every attempted entry (successful or blocked).
 * Split out of BidEntry.tsx/QuickBidEntry.tsx so the submit/validation
 * logic is directly testable without rendering the form.
 *
 * The feed's "N sold this session" tally for repeatable items is
 * deliberately session-scoped only (resets on page reload) - there is no
 * existing all-time "how many times has this item been won" aggregate
 * anywhere in this app (`winners` is a single itemId->name map, not a
 * count), and building one would mean a new server-side aggregation this
 * feature doesn't need to depend on.
 */
export function useQuickBidEntryState({ items, bidders, winners, recordWinningBid }: UseQuickBidEntryStateArgs) {
  const [itemId, setItemId] = useState("");
  const [bidderId, setBidderId] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feed, setFeed] = useState<QuickEntryFeedRow[]>([]);

  const itemInputRef = useRef<HTMLInputElement>(null);
  const bidderInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);

  // Guarded against an empty itemId/bidderId matching an item/bidder whose
  // own id happens to be an empty string too (a real data issue seen in
  // practice) - without this, `.find(i => i.id === itemId)` would return
  // that item/bidder as soon as the field is empty, showing its name/label
  // under a blank field. See docs/agents/CHANGELOG.md.
  const selectedItem = itemId.trim() ? items.find(i => i.id === itemId) : undefined;
  const selectedBidder = bidderId.trim() ? bidders.find(b => b.id === bidderId) : undefined;

  const isRepeatable = !!selectedItem?.allowMultipleWinners;
  const existingWinner = selectedItem ? winners[selectedItem.id] : undefined;
  const soldCountThisSession = selectedItem
    ? feed.filter(f => f.itemId === selectedItem.id && f.outcome === "recorded").length
    : 0;

  const focusItem = () => itemInputRef.current?.focus();
  const focusBidder = () => bidderInputRef.current?.focus();
  const focusPrice = () => priceInputRef.current?.focus();

  const handleSubmit = async () => {
    if (!selectedItem) {
      toast.error("Please fill in a valid item number");
      return;
    } else if (!selectedBidder) {
      toast.error("Please fill in a valid bidder number");
      return;
    } else if (!price) {
      toast.error("Please fill all fields");
      return;
    }

    if (!selectedBidder.checkedIn && !selectedBidder.isProxy) {
      toast.error("Bidder must be checked in (or be a proxy bidder)");
      return;
    }

    // Real risk this session's redesign feedback surfaced: entering the
    // same item twice for a non-repeatable item silently creates two
    // winning-bid records for one item, with no warning anywhere. Block
    // it here instead, unless the item is explicitly flagged as allowing
    // multiple winners (raffle tickets, Open Appeal tiers, etc.).
    if (!isRepeatable && existingWinner) {
      setFeed(prev => [{
        id: crypto.randomUUID(),
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        bidderId: selectedBidder.id,
        bidderName: `${selectedBidder.firstName} ${selectedBidder.lastName}`,
        price: parseFloat(price) || 0,
        timestamp: Date.now(),
        outcome: "blocked-duplicate",
      }, ...prev]);
      toast.error(`Item #${selectedItem.id} already has a winning bid (${existingWinner}) - not recorded.`);
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = await recordWinningBid(bidderId, itemId, parseFloat(price));

      setFeed(prev => [{
        id: crypto.randomUUID(),
        itemId: selectedItem.id,
        itemName: selectedItem.name,
        bidderId: selectedBidder.id,
        bidderName: `${selectedBidder.firstName} ${selectedBidder.lastName}`,
        price: parseFloat(price) || 0,
        timestamp: Date.now(),
        outcome: "recorded",
        idempotencyKey: idempotencyKey || undefined,
      }, ...prev]);

      toast.success(`Bid recorded for ${selectedBidder.firstName} — ${selectedItem.name}`);
      setItemId(""); setBidderId(""); setPrice("");
      focusItem();
    } catch (err: any) {
      toast.error(err.message || "Failed to record bid. UI was rolled back.");
    } finally {
      setSubmitting(false);
    }
  };

  return {
    itemId, setItemId,
    bidderId, setBidderId,
    price, setPrice,
    submitting,
    feed,
    itemInputRef, bidderInputRef, priceInputRef,
    focusItem, focusBidder, focusPrice,
    selectedItem, selectedBidder,
    isRepeatable, existingWinner, soldCountThisSession,
    handleSubmit,
  };
}
