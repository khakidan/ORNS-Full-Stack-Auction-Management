import { Box, Gift, Layers } from "lucide-react";

/**
 * Shared badge-coloring logic for both Auction Item catalogs - the
 * read-only Bid Management "Items" tab (ItemRow.tsx) and the editable
 * Auction Items Database (AuctionItemRow.tsx). Extracted so a category or
 * itemType always gets the same badge color regardless of which page is
 * showing it, rather than two independently-maintained copies drifting
 * apart. See docs/agents/refactor-opportunities.md's "UI / Layout Tweaks"
 * item / CHANGELOG.md.
 */

// A fixed palette, hashed by category name so the same category always
// gets the same color across every row and every render (no state, no
// lookup table to maintain as new categories get added in the
// spreadsheet - categories are free-text, unlike itemType below).
const CATEGORY_PALETTE = [
  "bg-blue-50 text-blue-700 border-blue-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-cyan-50 text-cyan-700 border-cyan-200",
  "bg-orange-50 text-orange-700 border-orange-200",
  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "bg-lime-50 text-lime-700 border-lime-200",
  "bg-pink-50 text-pink-700 border-pink-200",
  "bg-teal-50 text-teal-700 border-teal-200",
];

export function categoryBadgeClass(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash * 31 + category.charCodeAt(i)) | 0;
  }
  return CATEGORY_PALETTE[Math.abs(hash) % CATEGORY_PALETTE.length];
}

// itemType is a fixed 3-value enum (see AuctionItemsFilterControls.tsx's own
// "Physical Item"/"Certificate"/"Both" <select> options), so it gets an
// explicit color/icon map instead of the hash above - and deliberately
// none of these overlap with the Bundle badge's purple.
export const ITEM_TYPE_STYLES: Record<string, { className: string; icon: typeof Box }> = {
  "Physical Item": { className: "bg-sky-50 text-sky-700 border-sky-200", icon: Box },
  "Certificate": { className: "bg-amber-50 text-amber-700 border-amber-200", icon: Gift },
  "Both": { className: "bg-teal-50 text-teal-700 border-teal-200", icon: Layers },
};
